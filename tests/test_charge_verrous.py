"""Essai de charge des verrous (vagues 2 à 5) : pendant quelques secondes, tout en même temps, comme un soir de partie.
- Léa bouge son pion sans arrêt (pions libres), étoffe son histoire et l'envoie ; le MJ la tranche.
- Léa demande des aides à l'écriture (un faux modèle lent), choisit des activités ; le MJ les valide vers sa bourse ou une
  cagnotte, ou les refuse en lui rendant son tour ; il lui glisse des billets qu'elle lit, en retire.
- Basile lance des tests et répond à ceux que le MJ lui demande (le Tableau en demande, en retire).
- La TV passe du plan à une carte peinte et revient ; le fond de la carte se redépose.
- Basile range son sac (gestes appliqués seuls) et verse au sanctuaire ; le MJ accepte dans la boîte, en annule d'autres.
- L'éditeur du MJ, sourd au canal (il ne reçoit pas les déplacements), enregistre le plan en retard ; « Poser les
  adversaires » passe par le PATCH.
- L'onglet Sanctuaire enregistre, verse pour Aude et rend ; le carnet se republie.
- Vague 5 : Léa change de portrait et envoie ses images, que le MJ accepte pendant qu'il choisit dans la galerie et
  enregistre la fiche d'Aude ; la bibliothèque d'images importe, renomme et retire ; le MJ refait le provisoire d'Elian
  pendant qu'il choisit son mot de passe et qu'un autre appareil entre ; le compte principal s'assure de partout à la
  fois (test_vague_5_…).
Chaque verrou est espionné : l'ordre dans lequel chaque fil les prend est noté, et il ne doit y avoir ni cycle (deux
chemins qui les prennent dans l'ordre inverse), ni verrou de fichier repris par le fil qui le tient (il s'attendrait
lui-même), ni fil resté bloqué. Puis les comptes : aucun déplacement perdu par l'éditeur, aucun texte de l'éditeur
perdu, l'or de chacun juste (bourse d'activités comprise), une seule aide en vol à la fois et jamais plus d'aides que le
quota, aucune réponse 500. Et aucune fonction async n'attend (await) sous un verrou de fil, ni ne prend un verrou de fil
avec « async with »."""
import ast
import asyncio
import base64
import io
import json
import os
import random
import sys
import tempfile
import threading
import time
import traceback
from contextlib import contextmanager
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from commun import acces  # noqa: E402
from commun import aide  # noqa: E402
from commun import carnet  # noqa: E402
from commun import comptes  # noqa: E402
from mj import comptes_mj  # noqa: E402
from commun import confie  # noqa: E402
from commun import demandes  # noqa: E402
from commun import jets_distance  # noqa: E402
from coin_mj import jets_mj  # noqa: E402
import joueurs  # noqa: E402
from commun import lore  # noqa: E402
import main  # noqa: E402
from api import actions_coin, application, carnet_api, commandes_api, config, heros_etat, illustrations_api, portier, refuge, tv_etat, tv_fiches, utilitaires  # noqa: E402
from coin_mj import mouvements  # noqa: E402
from commun import portraits  # noqa: E402
from commun import prives  # noqa: E402
from commun import provisoires  # noqa: E402
from ia import redaction  # noqa: E402
from contenu import reserve  # noqa: E402
from contenu import sanctuaire  # noqa: E402
from commun import table_joueurs  # noqa: E402
from comptes_coin import entrer  # noqa: E402
from faux_modele import FauxClient, message  # noqa: E402
from PIL import Image  # noqa: E402

APP = Path(__file__).resolve().parent.parent / "app"
DUREE = 6.0  # secondes de charge
W, H = 10, 6
CL, CH = 12, 8  # la carte peinte
PROPOSITION = json.dumps({"genre": "suite", "note": "Une suite.", "texte": "Au matin, elle reprit la route."}, ensure_ascii=False)
RELECTURE = json.dumps({"bilan": "Le passage tient.", "version": "", "remarques": []}, ensure_ascii=False)


class FauxLent(FauxClient):
    """Le faux modèle de l'aide : lent (comme une vraie réponse, en plus court), il compte ce qui est en vol à la fois."""

    def __init__(self):
        super().__init__()
        self.en_vol = self.max_en_vol = 0
        self.garde = threading.Lock()

    async def create(self, **kwargs):
        with self.garde:
            self.en_vol += 1
            self.max_en_vol = max(self.max_en_vol, self.en_vol)
            self.appels.append(kwargs)
        try:
            await asyncio.sleep(0.25)
            relire = "# La demande : relire" in json.dumps(kwargs.get("messages"), ensure_ascii=False)
            return message(RELECTURE if relire else PROPOSITION)
        finally:
            with self.garde:
                self.en_vol -= 1


def png_de_carte() -> bytes:
    sortie = io.BytesIO()
    Image.new("RGB", (CL * 8, CH * 8), (96, 140, 70)).save(sortie, "PNG")
    return sortie.getvalue()


def activite_de_charge() -> dict:
    issues = {i: {"or": "1D4", "vers": "bourse", "recit": "{prenom} a travaillé."} for i in ("reussite-critique", "reussite", "echec", "echec-critique")}
    return {"id": "charge", "nom": "Travailler pour la charge", "texte": "Un travail.", "carac": "physique", "competences": ["Athlétisme"],
            "modificateur": 0, "places": None, "visible": True, "chantier": "", "notes_mj": "", "issues": issues}


# ---------------------------------------------------------------- l'espion des verrous

class Espion:
    def __init__(self):
        self.local = threading.local()
        self.aretes: dict[tuple, str] = {}  # (tenu, pris) → où, la première fois
        self.reprises: list[str] = []  # un verrou de fichier repris par le fil qui le tient
        self.garde = threading.Lock()

    def tenus(self) -> list:
        if not hasattr(self.local, "pile"):
            self.local.pile = []
        return self.local.pile

    def avant(self, nom: str, reentrant: bool) -> None:
        pile = self.tenus()
        if nom in pile and not reentrant:
            self.reprises.append(f"{nom} repris par le fil qui le tient :\n{''.join(traceback.format_stack(limit=12))}")
        with self.garde:
            for tenu in pile:
                if tenu != nom and (tenu, nom) not in self.aretes:
                    self.aretes[(tenu, nom)] = "".join(traceback.format_stack(limit=10)[:-2])

    def pris(self, nom: str) -> None:
        self.tenus().append(nom)

    def rendu(self, nom: str) -> None:
        pile = self.tenus()
        for i in range(len(pile) - 1, -1, -1):
            if pile[i] == nom:
                del pile[i]
                break

    def cycles(self) -> list:
        """Les cycles du graphe tenu → pris (un interblocage possible)."""
        suivants: dict[str, set] = {}
        for a, b in self.aretes:
            suivants.setdefault(a, set()).add(b)
        trouves = []

        def chercher(depart, noeud, chemin):
            for s in suivants.get(noeud, ()):
                if s == depart:
                    trouves.append([*chemin, s])
                elif s not in chemin and len(chemin) < 6:
                    chercher(depart, s, [*chemin, s])

        for n in suivants:
            chercher(n, n, [n])
        return trouves


class VerrouEspionne:
    """Un verrou de fil (Lock ou RLock) dont l'espion note chaque prise."""

    def __init__(self, vrai, nom: str, espion: Espion, reentrant: bool):
        self.vrai, self.nom, self.espion, self.reentrant = vrai, nom, espion, reentrant

    def acquire(self, *a, **k):
        self.espion.avant(self.nom, self.reentrant)
        ok = self.vrai.acquire(*a, **k)
        if ok:
            self.espion.pris(self.nom)
        return ok

    def release(self):
        self.espion.rendu(self.nom)
        self.vrai.release()

    def __enter__(self):
        self.acquire()
        return self

    def __exit__(self, *_):
        self.release()


def verrou_de_fichier_espionne(vrai, nom: str, espion: Espion):
    @contextmanager
    def verrou(*a, **k):
        espion.avant(nom, False)
        with vrai(*a, **k):
            espion.pris(nom)
            try:
                yield
            finally:
                espion.rendu(nom)
    return verrou


# ---------------------------------------------------------------- le monde

def grille(cases: dict, defaut=0) -> list:
    return [cases.get((x, y), defaut) for y in range(H) for x in range(W)]


@pytest.fixture(scope="module")
def monde():
    patch = pytest.MonkeyPatch()
    patch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    patch.setattr(joueurs, "COOKIE_SUR", False)
    patch.setattr(joueurs, "HOTES", set())
    patch.setattr(joueurs, "DEMANDES_FAITES", {})
    patch.setattr(joueurs, "DEPLACEMENTS_FAITS", {})
    with TestClient(application.app) as atelier:
        crees, invites = [], []

        def creer(collection, **fiche):
            f = atelier.post(f"/api/{collection}", json=fiche).json()
            crees.append((collection, f["id"]))
            return f

        m = {"atelier": atelier}
        for code, nom, heros, couleur in (("lea", "Léa", "Aude Charge", "#2e7d32"), ("basile", "Basile", "Bertrand Charge", "#1565c0"),
                                          (None, None, "Clothilde Charge", "#aa5500")):
            h = creer("aventuriers", nom=heros, genre="f", tablee=True, couleur=couleur, equipement=["Cape"], objets=["", "", ""])
            f = atelier.get(f"/api/aventuriers/{h['id']}").json()
            assert atelier.patch(f"/api/aventuriers/{h['id']}/sac", json={"or": {"avant": heros_etat.sac_de(f, "or"), "apres": 500}}).status_code == 200
            m[f"heros_{code or 'mj'}"] = h
            if code:
                invite = atelier.post("/api/joueurs", json={"nom": nom}).json()
                invites.append(invite["id"])
                assert atelier.post(f"/api/joueurs/{invite['id']}/relier", json={"heros": h["id"]}).status_code == 200
                coin = TestClient(joueurs.app)
                entrer(coin, invite)
                m[code], m[f"{code}_id"] = coin, invite["id"]
        m["seance"] = creer("seances", nom="Séance de charge", numero=7, date=time.strftime("%Y-%m-%d"))
        plan = creer("plans", nom="Plan de charge", lieu="", largeur=W, hauteur=H, m_case=1.5, brouillard_actif=True, style="couleur",
                     sol=[1] * (W * H), piece=[1] * (W * H), brouillard=[1] * (W * H), pieces=[{"id": 1, "nom": "La salle", "genre": "salle"}],
                     portes=[], objets=[], textes=[{"id": "t-mj", "texte": "Éditeur 0", "x": 8, "y": 5, "taille": 1}],
                     pions=[{"id": "t-aude", "genre": "heros", "nom": "Aude", "ref": f"aventurier:{m['heros_lea']['id']}", "x": 1.5, "y": 1.5},
                            {"id": "t-bertrand", "genre": "heros", "nom": "Bertrand", "ref": f"aventurier:{m['heros_basile']['id']}", "x": 6.5, "y": 4.5},
                            {"id": "t-gob", "genre": "ennemi", "nom": "Gobelin", "x": 8.5, "y": 0.5}])
        m["plan"] = plan
        atelier.put("/api/carnet-joueurs", json={"ouvert": True})
        s = sanctuaire.nouveau_sanctuaire()
        s["joueurs"] = True
        utilitaires.ecrire(refuge.SANCTUAIRE, s | {"modifie": utilitaires.maintenant()})
        assert atelier.put("/api/table-joueurs", json={"ouverte": True, "pions": "libres", "distance": 12, "distance_combat": 6, "entrer": True}).status_code == 200
        assert atelier.put("/api/table", json={"vue": "plan", "plan": plan["id"], "style": "couleur"}).status_code == 200
        carnet_api.publier_carnet()
        tv_etat.table_coin.tout_de_suite()
        # Vague 4. Les activités : une période qui change à chaque validation (le héros rejoue aussitôt), un catalogue ouvert.
        m["periode"] = {"n": 0}
        patch.setattr(actions_coin.activites_mj, "periode", lambda c=None, jour=None: {
            "cle": f"charge-{m['periode']['n']}", "libelle": f"Période {m['periode']['n']}", "court": "cette période", "mode": "semaine"})
        actuel = atelier.get("/api/activites").json()
        assert atelier.put("/api/activites", json={"ouvert": True, "periode": "semaine", "activites": [activite_de_charge()],
                                                   "version_base": actuel["modifie"]}).status_code == 200
        # Les billets : trois documents à remettre à Aude.
        m["documents"] = [creer("documents", nom=f"Lettre de charge {n}", genre="lettre", texte=f"Rendez-vous au gué, soir {n}.")
                          for n in range(3)]
        # La carte peinte que la TV montre par moments, avec son fond.
        m["carte"] = creer("cartes", nom="Carte de charge", largeur=CL, hauteur=CH, km_case=1, style="peint",
                           terrain=base64.b64encode(bytes([1]) * (CL * CH)).decode(), brouillard=base64.b64encode(bytes(CL * CH)).decode(),
                           marqueurs=[], etiquettes=[], traces=[])
        # L'aide à l'écriture : un faux modèle lent, un journal des coûts à part, assez d'aides pour toute la charge.
        m["modele"] = FauxLent()
        patch.setattr(redaction, "CLIENT", m["modele"])
        patch.setattr(redaction, "JOURNAL", Path(tempfile.mkdtemp(prefix="couts-charge-")) / "journal-ia.jsonl")
        patch.setattr(joueurs, "AIDES_FAITES", {})
        patch.setattr(joueurs, "JETS_LANCES", {})
        commandes_api.aides_joueurs.fichier_reglages.unlink(missing_ok=True)
        assert atelier.put("/api/aide-joueurs", json={"par_joueur": 6}).status_code == 200
        carnet_api.publier_carnet()
        actions_coin.jets_mj.publier()
        yield m
        commandes_api.aides_joueurs.fichier_reglages.unlink(missing_ok=True)
        for f in (actions_coin.activites_mj.fichier, actions_coin.activites_mj.journal.fichier, actions_coin.jets_mj.fichier, tv_fiches.billets_prives.fichier):
            f.unlink(missing_ok=True)
        atelier.put("/api/table", json={"vue": "accueil"})
        atelier.put("/api/table-joueurs", json={"ouverte": False})
        for ident in invites:
            atelier.delete(f"/api/joueurs/{ident}")
        for collection, ident in crees:
            atelier.delete(f"/api/{collection}/{ident}")
        refuge.SANCTUAIRE.unlink(missing_ok=True)
        tv_etat.TABLE_JOUEURS.unlink(missing_ok=True)
        table_joueurs.fermer(config.PROPOSITIONS)
        carnet_api.publier_carnet()
        tv_fiches.billets_prives.publier()
        actions_coin.jets_mj.publier()
    patch.undo()


@pytest.fixture()
def espion():
    e = Espion()
    patch = pytest.MonkeyPatch()
    patch.setattr(heros_etat, "SAC_VERROU", VerrouEspionne(heros_etat.SAC_VERROU, "SAC_VERROU", e, True))
    patch.setattr(refuge, "VERROU_SANCTUAIRE", VerrouEspionne(refuge.VERROU_SANCTUAIRE, "VERROU_SANCTUAIRE", e, True))
    patch.setattr(tv_etat.mouvements_joueurs, "verrou", VerrouEspionne(tv_etat.mouvements_joueurs.verrou, "mouvements", e, True))
    patch.setattr(tv_etat.table_coin, "verrou", VerrouEspionne(tv_etat.table_coin.verrou, "table du coin", e, False))
    patch.setattr(commandes_api.sacs, "verrou", VerrouEspionne(commandes_api.sacs.verrou, "journal du sac", e, False))
    patch.setattr(carnet, "PUBLICATION", VerrouEspionne(carnet.PUBLICATION, "carnet.PUBLICATION", e, False))
    patch.setattr(demandes, "verrou", verrou_de_fichier_espionne(demandes.verrou, "demandes.verrou", e))
    patch.setattr(lore, "verrou", verrou_de_fichier_espionne(lore.verrou, "lore.verrou", e))
    patch.setattr(carnet, "verrou", verrou_de_fichier_espionne(carnet.verrou, "carnet.verrou", e))
    # Vague 4 : le catalogue et le journal des activités, les envois des billets et leur publication, les lectures notées
    # par le coin.
    patch.setattr(actions_coin.activites_mj, "verrou", VerrouEspionne(actions_coin.activites_mj.verrou, "catalogue des activités", e, True))
    patch.setattr(actions_coin.activites_mj.journal, "verrou", VerrouEspionne(actions_coin.activites_mj.journal.verrou, "journal des activités", e, False))
    patch.setattr(tv_fiches.billets_prives, "verrou", VerrouEspionne(tv_fiches.billets_prives.verrou, "envois des billets", e, False))
    patch.setattr(prives, "PUBLICATION", VerrouEspionne(prives.PUBLICATION, "prives.PUBLICATION", e, False))
    patch.setattr(prives, "verrou", verrou_de_fichier_espionne(prives.verrou, "prives.verrou", e))
    yield e
    patch.undo()


# ---------------------------------------------------------------- la charge

def test_tout_en_meme_temps_sans_interblocage(monde, espion):
    atelier = monde["atelier"]
    plan_id = monde["plan"]["id"]
    fin = time.monotonic() + DUREE
    erreurs, compte = [], {}
    verse = {"lea": 0, "basile": 0}  # l'or que la boîte a vraiment pris
    mj = {"verse": 0, "rendu": 0}
    dernier_texte = {"v": "Éditeur 0"}
    garde = threading.Lock()

    def noter(nom, r):
        with garde:
            compte[nom] = compte.get(nom, 0) + 1
        if r.status_code >= 500:
            erreurs.append(f"{nom} : {r.status_code} {r.text[:200]}")

    def boucle(nom, geste):
        def tourner():
            try:
                while time.monotonic() < fin:
                    geste()
            except Exception:
                erreurs.append(f"{nom} : {traceback.format_exc()}")
        return threading.Thread(target=tourner, name=nom, daemon=True)

    def lea_bouge():
        t = monde["lea"].get("/api/table").json()
        if not (t.get("vue") or {}).get("plan"):
            time.sleep(0.05)  # la TV montre la carte : rien à bouger
            return
        moi = next((x for x in t["vue"]["plan"]["pions"] if x["id"] == "t-aude"), None)
        if not moi:
            return
        ici = [int(moi["x"] // 1), int(moi["y"] // 1)]
        vers = [random.randint(0, 4), random.randint(0, 3)]
        if vers == ici:
            return
        r = monde["lea"].post("/api/demandes", json={"genre": "deplacement", "corps": {"plan": t["vue"]["plan"]["id"], "pion": "t-aude", "depuis": ici, "vers": vers}})
        noter("déplacement", r)
        time.sleep(0.05)

    def lea_histoire():
        n = random.randint(1, 10_000)
        r = monde["lea"].put("/api/lore", json={"champs": {"defaut": f"Un défaut {n}."}})
        noter("lore enregistré", r)
        r = monde["lea"].post("/api/lore/envoyer", json={})
        noter("lore envoyé", r)
        time.sleep(0.2)

    def basile_sac():
        r = monde["basile"].post("/api/demandes", json={"genre": "sac", "corps": {"geste": "ajouter", "liste": "equipement", "ligne": f"Corde {random.randint(1, 99)}"}})
        noter("geste du sac", r)
        time.sleep(0.15)

    def basile_verse():
        s = monde["basile"].get("/api/sanctuaire").json()
        b = next((x for x in s.get("elements") or [] if x.get("genre") == "batiment"), None)
        if b:
            r = monde["basile"].post("/api/demandes", json={"genre": "versement", "corps": {"batiment": b["id"], "or": random.randint(1, 3)}})
            noter("versement demandé", r)
        time.sleep(0.25)

    def boite():
        v = atelier.get("/api/demandes").json()
        for x in v["attente"]:
            if x.get("type") != "demande":
                continue
            if x["genre"] == "versement":
                r = atelier.post(f"/api/demandes/{x['joueur']}/{x['id']}/accepter", json={"version": x["version"]})
                noter("versement accepté", r)
                if r.status_code == 200:
                    pris = r.json().get("resultat") or ""
                    if "po versées" in pris:
                        with garde:
                            verse["basile"] += int(pris.split(" po")[0])
            elif x["genre"] == "lore":
                c = atelier.get(f"/api/lore/{x['joueur']}/{x['id']}")
                if c.status_code != 200:
                    noter("comparaison", c)
                    continue
                c = c.json()
                choix = {p["cle"]: {"decision": "accepter", "empreinte": p["empreinte"], "ecraser": True} for p in c["champs"]}
                r = atelier.post(f"/api/lore/{x['joueur']}/{x['id']}/trancher", json={"version": c["version"], "champs": choix})
                noter("lore tranché", r)
        for x in v["historique"][:5]:
            if x.get("annulable") and x["genre"] == "sac" and random.random() < 0.3:
                noter("geste annulé", atelier.post(f"/api/demandes/{x['joueur']}/{x['id']}/annuler", json={"version": x["version"]}))
        time.sleep(0.1)

    copie = {"p": atelier.get(f"/api/plans/{plan_id}").json()}

    def editeur_sourd():
        # Un éditeur qui ne reçoit pas les déplacements : il renvoie sa copie, avec sa version, et ne relit qu'après un conflit.
        p = copie["p"]
        n = random.randint(1, 10_000)
        next(t for t in p["textes"] if t["id"] == "t-mj")["texte"] = f"Éditeur {n}"
        r = atelier.put(f"/api/plans/{plan_id}", json={**p, "version_base": p["modifie"]})
        noter("éditeur", r)
        if r.status_code == 200:
            dernier_texte["v"] = f"Éditeur {n}"
            copie["p"] = {k: v for k, v in r.json().items() if k != "rejoues"}
        elif r.status_code == 409:
            copie["p"] = atelier.get(f"/api/plans/{plan_id}").json()
        time.sleep(0.12)

    def adversaires():
        # « Poser les adversaires » : le PATCH des pions, le gobelin d'une case à l'autre.
        p = atelier.get(f"/api/plans/{plan_id}").json()
        pions = [dict(t, x=8.5, y=random.choice([0.5, 1.5])) if t["id"] == "t-gob" else t for t in p["pions"]]
        r = atelier.patch(f"/api/plans/{plan_id}", json={"pions": pions, "version_base": p["modifie"]})
        noter("adversaires", r)
        time.sleep(0.4)

    def onglet_sanctuaire():
        s = atelier.get("/api/sanctuaire").json()
        r = atelier.put("/api/sanctuaire", json={**s, "accroche": f"Accroche {random.randint(1, 999)}", "version_base": s["modifie"]})
        noter("sanctuaire enregistré", r)
        b = s["batiments"][0]
        r = atelier.post("/api/sanctuaire/versements", json={"batiment": b["id"], "aventurier": monde["heros_mj"]["id"], "or": 2})
        noter("versement du MJ", r)
        if r.status_code == 200:
            with garde:
                mj["verse"] += r.json()["pris"]
            vid = (r.json().get("versement") or {}).get("id")
            if vid and random.random() < 0.5:
                d = atelier.delete(f"/api/sanctuaire/versements/{vid}")
                noter("versement rendu", d)
                if d.status_code == 200:
                    with garde:
                        mj["rendu"] += d.json()["rendu"]["or"]
        time.sleep(0.2)

    def carnet_et_table():
        carnet_api.publier_carnet()
        tv_etat.table_coin.tout_de_suite()
        noter("lectures", atelier.get("/api/demandes"))
        time.sleep(0.1)

    # ---- Vague 4
    gagne = {"bourse": 0, "cagnotte": 0}  # l'or des activités validées, tel que la boîte l'a vraiment versé

    def lea_aide():
        mode = random.choice(["proposer", "relire"])
        r = monde["lea"].post("/api/aide", json={"mode": mode, "champ": "histoire", "texte": f"Née au gué, un soir {random.randint(1, 99)}.",
                                                 "question": ""})
        noter("aide demandée", r)
        time.sleep(0.15)

    def lea_activite():
        r = monde["lea"].get("/api/activites")
        noter("activités lues", r)
        a = r.json() if r.status_code == 200 else {}
        if a.get("visible") and not a.get("courante") and a.get("activites"):
            r = monde["lea"].post("/api/demandes", json={"genre": "activite", "corps": {"activite": a["activites"][0]["id"], "mot": ""}})
            noter("activité choisie", r)
        time.sleep(0.1)

    def mj_activites():
        lea = monde["lea_id"]
        for d in demandes.lire(config.PROPOSITIONS, lea):
            if d["genre"] != "activite" or d["statut"] != demandes.EN_ATTENTE or not d.get("fige"):
                continue
            choix = random.choice(["bourse", "cagnotte", "rendre"])
            if choix == "rendre":
                corps = {"decision": "refuser", "rendre": True}
            else:
                s = atelier.get("/api/sanctuaire").json()
                b = next((b for b in s["batiments"] if sanctuaire.prochain(s, b)), None)
                if choix == "cagnotte" and not b:
                    continue
                montant = random.randint(1, 4) if choix == "bourse" else 1
                corps = {"decision": "valider", "montant": montant, "vers": "bourse" if choix == "bourse" else f"batiment:{b['id']}"}
                with garde:
                    m_ = monde["periode"]
                    m_["n"] += 1  # la période suivante : Aude rejoue dès que la section se republie
            r = atelier.post(f"/api/activites/demandes/{lea}/{d['id']}/trancher", json={"version": d["version"], **corps})
            noter(f"activité tranchée ({choix})", r)
            if r.status_code == 200 and choix == "bourse":
                with garde:
                    gagne["bourse"] += corps["montant"]
            elif r.status_code == 200 and choix == "cagnotte":
                with garde:
                    gagne["cagnotte"] += 1
        time.sleep(0.1)

    def mj_billets():
        doc = random.choice(monde["documents"])
        r = atelier.post("/api/prives/document", json={"document": doc["id"], "heros": monde["heros_lea"]["id"], "confirme": True})
        noter("billet remis", r)
        if random.random() < 0.3:
            envois = atelier.get("/api/prives").json()["envois"]
            if envois:
                noter("billet retiré", atelier.delete(f"/api/prives/{random.choice(envois)['id']}"))
        time.sleep(0.15)

    def lea_lit():
        r = monde["lea"].get("/api/prives")
        noter("billets lus", r)
        for b in (r.json().get("billets") or []) if r.status_code == 200 else []:
            if not b.get("lu"):
                noter("billet marqué lu", monde["lea"].post(f"/api/prives/{b['id']}/lu", json={}))
        time.sleep(0.1)

    def basile_jette():
        j = monde["basile"].get("/api/jets")
        noter("jets lus", j)
        j = j.json() if j.status_code == 200 else {}
        if j.get("demande"):
            r = monde["basile"].post("/api/jets", json={"demande": j["demande"]["id"], "carac": j["demande"]["carac"], "competence": ""})
            noter("test demandé lancé", r)
        elif j.get("heros"):
            r = monde["basile"].post("/api/jets", json={"carac": random.choice(["physique", "social", "mental"]), "competence": "",
                                                        "modificateur": random.randint(-10, 10)})
            noter("test lancé", r)
        time.sleep(0.1)

    def tableau():
        basile = monde["basile_id"]
        if random.random() < 0.6:
            r = atelier.post("/api/jets/demander", json={"joueur": basile, "carac": random.choice(["physique", "mental"]), "modificateur": -5})
            noter("test demandé", r)
        else:
            for d in atelier.get("/api/jets").json()["demandes"]:
                r = atelier.post(f"/api/jets/demandes/{d['joueur']}/{d['id']}/retirer", json={"version": d["version"]})
                noter("test retiré", r)
        time.sleep(0.3)

    tours = {"n": 0}

    def la_tv():
        tours["n"] += 1
        carte = monde["carte"]["id"]
        if tours["n"] % 4 == 1:
            version = atelier.get(f"/api/cartes/{carte}/publique").json()["modifie"]
            r = atelier.put(f"/api/cartes/{carte}/fond", params={"version": version, "echelle": 8}, content=png_de_carte(),
                            headers={"Content-Type": "image/png"})
            noter("fond déposé", r)
        noter("carte montrée", atelier.put("/api/table", json={"vue": "carte", "carte": carte, "style": "peint"}))
        time.sleep(0.25)
        noter("plan remontré", atelier.put("/api/table", json={"vue": "plan", "plan": plan_id, "style": "couleur"}))
        time.sleep(0.6)

    fils = [boucle("Léa bouge", lea_bouge), boucle("Léa écrit", lea_histoire), boucle("Basile range", basile_sac),
            boucle("Basile verse", basile_verse), boucle("la boîte", boite), boucle("l'éditeur", editeur_sourd),
            boucle("les adversaires", adversaires), boucle("l'onglet Sanctuaire", onglet_sanctuaire), boucle("le carnet", carnet_et_table),
            boucle("Léa demande une aide", lea_aide), boucle("Léa s'occupe", lea_activite), boucle("les activités du MJ", mj_activites),
            boucle("les billets du MJ", mj_billets), boucle("Léa lit", lea_lit), boucle("Basile jette", basile_jette),
            boucle("le Tableau", tableau), boucle("la TV", la_tv)]
    # La boucle d'événements de l'atelier (la TV, toutes les pages) ne doit jamais rester prise : une sonde y dort 20 ms
    # en boucle et note son plus grand retard.
    retard = {"max": 0.0, "fin": False}

    async def sonde():
        while not retard["fin"]:
            avant = time.monotonic()
            await asyncio.sleep(0.02)
            retard["max"] = max(retard["max"], time.monotonic() - avant - 0.02)

    atelier.portal.start_task_soon(sonde)
    for f in fils:
        f.start()
    for f in fils:
        f.join(DUREE + 60)
    retard["fin"] = True
    bloques = [f.name for f in fils if f.is_alive()]
    assert not bloques, f"fils restés bloqués (interblocage ?) : {bloques}"
    # Sous cette charge, la boucle se prend quelques dixièmes de seconde au plus (la boîte qui se recompte, une réponse
    # compressée) ; une seconde et demie, c'est qu'elle a attendu un verrou tenu pendant un appel lent.
    assert retard["max"] < 1.5, f"la boucle de l'atelier est restée prise {retard['max']:.2f} s"
    assert not erreurs, "\n".join(erreurs[:5])
    assert not espion.reprises, espion.reprises[0]
    cycles = espion.cycles()
    assert not cycles, "ordres de prise inverses : " + "; ".join(" → ".join(c) for c in cycles) + "\n" + "\n".join(
        f"{a} puis {b} :\n{ou}" for (a, b), ou in espion.aretes.items() if any(a in c and b in c for c in cycles))
    for geste in ("déplacement", "éditeur", "geste du sac", "versement accepté", "lore tranché", "versement du MJ", "aide demandée",
                  "activité choisie", "billet remis", "billet marqué lu", "test lancé", "test demandé", "carte montrée", "fond déposé"):
        assert compte.get(geste, 0) > 0, f"rien n'a été essayé pour « {geste} » : {compte}"
    assert any(compte.get(f"activité tranchée ({c})", 0) for c in ("bourse", "cagnotte")), compte

    # Les comptes, une fois la boîte vidée de ce qui s'applique seul.
    def calme():
        return not any(d["statut"] == demandes.A_APPLIQUER for j in ("lea_id", "basile_id") for d in demandes.lire(config.PROPOSITIONS, monde[j]))
    fin_calme = time.monotonic() + 10
    while not calme() and time.monotonic() < fin_calme:
        time.sleep(0.1)
    assert calme()
    p = atelier.get(f"/api/plans/{plan_id}").json()
    journal = [m for m in tv_etat.mouvements_joueurs.lire_journal(plan_id) if m.get("pion") == "t-aude"]
    aude = next(t for t in p["pions"] if t["id"] == "t-aude")
    if journal:
        assert [aude["x"], aude["y"]] == journal[-1]["apres"], "un déplacement a été perdu par l'éditeur en retard"
    assert next(t for t in p["textes"] if t["id"] == "t-mj")["texte"] == dernier_texte["v"], "le dernier texte de l'éditeur est perdu"
    bertrand = atelier.get(f"/api/aventuriers/{monde['heros_basile']['id']}").json()
    assert bertrand["or"] == 500 - verse["basile"], (bertrand["or"], verse)
    clothilde = atelier.get(f"/api/aventuriers/{monde['heros_mj']['id']}").json()
    assert clothilde["or"] == 500 - mj["verse"] + mj["rendu"], (clothilde["or"], mj)
    # Vague 4 : l'or d'Aude, celui des seules activités validées vers sa bourse (une cagnotte ne la touche pas).
    aude_or = atelier.get(f"/api/aventuriers/{monde['heros_lea']['id']}").json()["or"]
    assert aude_or == 500 + gagne["bourse"], (aude_or, gagne)
    # Les aides : une seule en vol à la fois, jamais plus d'appels que le quota d'Aude, chacune close (ni perdue ni doublée).
    modele = monde["modele"]
    assert modele.max_en_vol == 1, modele.max_en_vol
    aides = [d for d in demandes.lire(config.PROPOSITIONS, monde["lea_id"]) if d["genre"] == aide.GENRE]
    assert all(d["statut"] != demandes.A_APPLIQUER for d in aides)
    assert 0 < len(modele.appels) <= 6, len(modele.appels)
    assert commandes_api.aides_joueurs.usage()["par_qui"].get(monde["lea_id"], {}).get("aides", 0) == len(modele.appels)
    # Chaque jet appliqué est au registre une seule fois ; aucun test demandé n'est resté « ouvert » au registre alors que
    # le fichier de Basile le dit répondu.
    registre = actions_coin.jets_mj.lire_registre()
    ids = [x["id"] for x in registre["jets"]]
    assert len(ids) == len(set(ids)) and ids
    repondues = {d["id"]: d["repondue"] for d in demandes.lire(config.PROPOSITIONS, monde["basile_id"]) if d["genre"] == "jet-demande" and d.get("repondue")}
    for x in registre["demandes"]:
        if x["id"] in repondues and x.get("etat") == "ouverte":
            jet = next((d for d in demandes.lire(config.PROPOSITIONS, monde["basile_id"]) if d["id"] == repondues[x["id"]]), None)
            assert jet is None or jet["statut"] == demandes.ECHEC, (x, jet)
    print("gestes :", compte, "arêtes :", sorted(espion.aretes), f"retard de la boucle : {retard['max'] * 1000:.0f} ms")


# ---------------------------------------------------------------- vague 5 : portraits, bibliothèque, provisoires, comptes MJ

class Charge:
    """Des fils qui répètent chacun un geste pendant la durée, comme le test d'avant : ce qu'ils essaient, leurs 500 et
    leurs exceptions."""

    def __init__(self, duree: float):
        self.fin = time.monotonic() + duree
        self.duree = duree
        self.erreurs: list = []
        self.compte: dict = {}
        self.garde = threading.Lock()

    def noter(self, nom, r):
        with self.garde:
            self.compte[nom] = self.compte.get(nom, 0) + 1
        if r.status_code >= 500:
            self.erreurs.append(f"{nom} : {r.status_code} {r.text[:200]}")
        return r

    def lancer(self, gestes: dict) -> list:
        def tourner(nom, geste):
            try:
                while time.monotonic() < self.fin:
                    geste()
            except Exception:
                self.erreurs.append(f"{nom} : {traceback.format_exc()}")
        fils = [threading.Thread(target=tourner, args=(n, g), name=n, daemon=True) for n, g in gestes.items()]
        for f in fils:
            f.start()
        for f in fils:
            f.join(self.duree + 60)
        return [f.name for f in fils if f.is_alive()]


def jpeg(taille=(300, 400)) -> bytes:
    sortie = io.BytesIO()
    Image.new("RGB", taille, tuple(random.randint(0, 255) for _ in range(3))).save(sortie, "JPEG")
    return sortie.getvalue()


def png(taille=(48, 48)) -> bytes:
    sortie = io.BytesIO()
    Image.new("RGBA", taille, (*(random.randint(0, 255) for _ in range(3)), 128)).save(sortie, "PNG")
    return sortie.getvalue()


def calme_pour(joueur: str, delai: float = 10.0) -> bool:
    fin = time.monotonic() + delai
    while time.monotonic() < fin:
        if not any(d["statut"] == demandes.A_APPLIQUER for d in demandes.lire(config.PROPOSITIONS, joueur)):
            return True
        time.sleep(0.1)
    return False


def test_vague_5_portraits_en_meme_temps(monde, espion):
    """Léa change de portrait (appliqué seul) et envoie ses images ; le MJ les accepte ou les refuse dans la boîte, annule
    des choix, choisit lui-même dans la galerie, enregistre la fiche d'Aude depuis son éditeur ; Léa range son sac (la même
    fiche) ; les portraits se republient sans arrêt. À la fin : aucun portrait accepté ne manque à la fiche, le portrait
    du moment en fait partie, aucun geste du sac ni texte de l'éditeur n'est perdu, l'index publié se lit toujours."""
    atelier = monde["atelier"]
    aude, lea_id = monde["heros_lea"]["id"], monde["lea_id"]
    patch = pytest.MonkeyPatch()
    patch.setattr(actions_coin.portraits_joueurs, "verrou", heros_etat.SAC_VERROU)
    patch.setattr(actions_coin.portraits_joueurs, "verrou_journal",
                  VerrouEspionne(actions_coin.portraits_joueurs.verrou_journal, "journal des portraits", espion, False))
    patch.setattr(portraits, "PUBLICATION", VerrouEspionne(portraits.PUBLICATION, "portraits.PUBLICATION", espion, False))
    patch.setattr(portraits, "verrou", verrou_de_fichier_espionne(portraits.verrou, "portraits.verrou", espion))
    patch.setattr(portraits, "ESSAIS_PAR_JOUEUR", (10_000, 600))
    patch.setattr(demandes, "PAR_HEURE", 10_000)
    patch.setattr(joueurs, "ENVOIS_ESSAYES", {})
    patch.setattr(joueurs, "DEMANDES_FAITES", {})
    patch.setattr(joueurs, "CHOIX_EN_ROUTE", 0)
    try:
        for _ in range(3):
            nom = f"portrait-charge-{os.urandom(6).hex()}.jpg"
            (config.IMAGES / nom).write_bytes(jpeg())
            r = atelier.post(f"/api/aventuriers/{aude}/illustrations", json={"url": f"/media/{nom}", "source": "ia", "prompt": ""})
            assert r.status_code == 200, r.text
        actions_coin.portraits_joueurs.publier()
        cle = carnet.cle_heros(next(j["jeton"] for j in joueurs.acces() if j["id"] == lea_id))
        index = config.PROPOSITIONS / portraits.DOSSIER / cle / portraits.INDEX
        assert index.is_file()
        ch = Charge(DUREE)
        lignes_du_sac, dernier = [], {"notes": None}

        def lea_choisit():
            e = ch.noter("portraits lus", monde["lea"].get("/api/portraits")).json()
            autres = [p for p in e.get("portraits") or [] if not p.get("actuel")]
            if autres:
                ch.noter("portrait choisi", monde["lea"].post("/api/demandes", json={"genre": portraits.GENRE_CHOIX,
                                                                                     "corps": {"portrait": random.choice(autres)["nom"]}}))
            time.sleep(0.08)

        def lea_envoie():
            ch.noter("image envoyée", monde["lea"].post("/api/portraits/envoi", content=jpeg(), headers={"Content-Type": "image/jpeg"}))
            time.sleep(0.25)

        def boite_du_mj():
            v = atelier.get("/api/demandes").json()
            for x in v["attente"]:
                if x.get("type") == "demande" and x["genre"] == portraits.GENRE_ENVOI:
                    geste = "refuser" if random.random() < 0.2 else "accepter"
                    ch.noter(f"image {geste}", atelier.post(f"/api/demandes/{x['joueur']}/{x['id']}/{geste}", json={"version": x["version"]}))
            for x in v["historique"][:6]:
                if x.get("annulable") and x["genre"] == portraits.GENRE_CHOIX and random.random() < 0.3:
                    ch.noter("choix annulé", atelier.post(f"/api/demandes/{x['joueur']}/{x['id']}/annuler", json={"version": x["version"]}))
            time.sleep(0.1)

        def galerie():
            f = atelier.get(f"/api/aventuriers/{aude}").json()
            urls = [i["url"] for i in f.get("illustrations") or []]
            ch.noter("choisi dans la galerie", atelier.put(f"/api/aventuriers/{aude}/illustration", json={"url": random.choice(urls)}))
            time.sleep(0.05)

        def editeur():
            f = atelier.get(f"/api/aventuriers/{aude}").json()
            n = f"Notes de l'éditeur {random.randint(1, 10 ** 6)}"
            r = ch.noter("fiche enregistrée", atelier.put(f"/api/aventuriers/{aude}", json={**f, "notes_mj": n, "version_base": f["modifie"]}))
            if r.status_code == 200:
                dernier["notes"] = n
            time.sleep(0.12)

        def lea_sac():
            ligne = f"Corde de charge {random.randint(1, 10 ** 6)}"
            r = ch.noter("geste du sac", monde["lea"].post("/api/demandes", json={"genre": "sac", "corps": {"geste": "ajouter", "liste": "equipement", "ligne": ligne}}))
            if r.status_code == 200:
                lignes_du_sac.append(ligne)
            time.sleep(0.15)

        def publication():
            actions_coin.portraits_joueurs.publier()
            time.sleep(0.05)

        def lecteur():
            json.loads(index.read_text(encoding="utf-8"))
            time.sleep(0.01)

        bloques = ch.lancer({"Léa choisit": lea_choisit, "Léa envoie": lea_envoie, "la boîte": boite_du_mj, "la galerie": galerie,
                             "l'éditeur": editeur, "Léa range": lea_sac, "la publication": publication, "le lecteur": lecteur})
        assert not bloques, f"fils restés bloqués (interblocage ?) : {bloques}"
        assert not ch.erreurs, "\n".join(ch.erreurs[:5])
        assert not espion.reprises, espion.reprises[0]
        assert not espion.cycles(), espion.cycles()
        for geste in ("portrait choisi", "image envoyée", "image accepter", "choisi dans la galerie", "fiche enregistrée", "geste du sac"):
            assert ch.compte.get(geste, 0) > 0, f"rien n'a été essayé pour « {geste} » : {ch.compte}"
        assert calme_pour(lea_id)
        f = atelier.get(f"/api/aventuriers/{aude}").json()
        urls = [i["url"] for i in f["illustrations"]]
        acceptees = [n["apres"] for k, n in actions_coin.portraits_joueurs.journal_lire().items() if k.startswith(f"{lea_id}:") and n.get("accepte")]
        assert acceptees, ch.compte
        perdues = [u for u in acceptees if u not in urls]
        assert not perdues, f"{len(perdues)} portrait(s) accepté(s) perdu(s) par une écriture concurrente de la fiche : {perdues[:3]}"
        assert f["illustration"] in urls
        appliques = [d["corps"]["ligne"] for d in demandes.lire(config.PROPOSITIONS, lea_id) if d["genre"] == "sac" and d["statut"] == demandes.APPLIQUEE]
        manquent = [x for x in appliques if x not in f.get("equipement", [])]
        assert not manquent, f"geste(s) du sac perdu(s) : {manquent[:3]}"
        assert dernier["notes"] is None or f.get("notes_mj") == dernier["notes"], "le dernier enregistrement de l'éditeur est perdu"
        print("gestes :", ch.compte)
    finally:
        patch.undo()


def test_vague_5_bibliotheque_d_images_en_meme_temps(monde):
    """Trois importeurs, chacun avec qui renomme et qui retire ses images, et un lecteur du fichier : aucune image perdue
    ni ressuscitée, le dernier nom de chacune gardé, le fichier toujours entier, chaque image listée sur le disque."""
    atelier = monde["atelier"]
    biblio = illustrations_api.BIBLIOTHEQUE_IMAGES
    avant = biblio.fichier.read_bytes() if biblio.fichier.exists() else None
    importes = {k: [] for k in range(3)}
    noms, retires = {}, set()
    ch = Charge(DUREE)

    def importer(k):
        def geste():
            r = ch.noter("import", atelier.post("/api/bibliotheque-images", files={"image": ("x.png", png(), "image/png")},
                                                data={"nom": f"Image {k}", "rayon": f"Rayon {k}"}))
            if r.status_code == 200:
                importes[k].append(r.json()["id"])
                noms[r.json()["id"]] = r.json()["nom"]
            time.sleep(0.03)
        return geste

    def renommer(k):
        def geste():
            vivants = [i for i in importes[k] if i not in retires]
            if vivants:
                i, n = random.choice(vivants), f"Nom {k} {random.randint(1, 10 ** 6)}"
                r = ch.noter("renommage", atelier.patch(f"/api/bibliotheque-images/{i}", json={"nom": n}))
                if r.status_code == 200:
                    noms[i] = n
            time.sleep(0.02)
        return geste

    def retirer(k):
        def geste():
            vivants = [i for i in importes[k] if i not in retires]
            if vivants and random.random() < 0.4:
                i = random.choice(vivants)
                if ch.noter("retrait", atelier.delete(f"/api/bibliotheque-images/{i}")).status_code == 200:
                    retires.add(i)
            time.sleep(0.05)
        return geste

    def lecteur():
        try:
            json.loads(biblio.fichier.read_text(encoding="utf-8"))
        except FileNotFoundError:
            pass
        time.sleep(0.005)

    try:
        gestes = {"le lecteur": lecteur}
        for k in range(3):
            gestes |= {f"import {k}": importer(k), f"renommage {k}": renommer(k), f"retrait {k}": retirer(k)}
        bloques = ch.lancer(gestes)
        assert not bloques, bloques
        assert not ch.erreurs, "\n".join(ch.erreurs[:5])
        assert all(ch.compte.get(g, 0) > 0 for g in ("import", "renommage", "retrait")), ch.compte
        tous = {i for liste in importes.values() for i in liste}
        liste = {x["id"]: x for x in atelier.get("/api/bibliotheque-images").json()["images"]}
        assert set(liste) >= tous - retires, "image(s) importée(s) perdue(s)"
        assert not (set(liste) & retires), "image(s) retirée(s) revenue(s)"
        assert {i: liste[i]["nom"] for i in tous - retires} == {i: noms[i] for i in tous - retires}, "un renommage perdu"
        assert all((config.IMAGES / x["url"].split("/media/", 1)[1]).is_file() for x in liste.values())
        print("gestes :", ch.compte)
    finally:
        for i in importes.values():
            for ident in i:
                atelier.delete(f"/api/bibliotheque-images/{ident}")
        if avant is None:
            biblio.fichier.unlink(missing_ok=True)
        else:
            biblio.fichier.write_bytes(avant)


def test_vague_5_provisoires_en_meme_temps(monde):
    """Le MJ refait le provisoire d'Elian sans arrêt (et revoit ses joueurs, qui range les provisoires servis) ; un appareil
    entre avec le dernier provisoire reçu et choisit son mot de passe ; un autre entre avec le dernier mot de passe choisi.
    Jamais deux secrets valables à la fois : un provisoire écrit fait tomber le mot de passe d'avant et toutes les sessions,
    un provisoire refait fait tomber le précédent ; les fichiers du compte et du provisoire se lisent toujours en entier."""
    atelier = monde["atelier"]
    patch = pytest.MonkeyPatch()
    patch.setattr(joueurs, "ESSAIS", acces.Essais())
    patch.setattr(joueurs, "ECHECS_PAR_ADRESSE", (10 ** 6, 900))
    patch.setattr(joueurs, "ECHECS_PAR_IDENTIFIANT", (10 ** 6, 3600))
    patch.setattr(joueurs, "ECHECS_EN_TOUT", 10 ** 6)
    patch.setattr(joueurs, "ATTENTE_ECHEC", 0)
    elian = atelier.post("/api/joueurs", json={"nom": "Elian Charge"}).json()
    eid, ident = elian["id"], f"elian-charge-{os.urandom(3).hex()}"
    provs, choisis, entrees_a, entrees_b, sessions = [], [], [], [], []
    try:
        r = atelier.post(f"/api/joueurs/{eid}/provisoire", json={"identifiant": ident})
        assert r.status_code == 200, r.text
        provs.append((0.0, time.monotonic(), r.json()["provisoire"]))
        ch = Charge(DUREE)
        a, b = TestClient(joueurs.app), TestClient(joueurs.app)

        def mj():
            t0 = time.monotonic()
            r = ch.noter("provisoire", atelier.post(f"/api/joueurs/{eid}/provisoire", json={}))
            if r.status_code == 200:
                provs.append((t0, time.monotonic(), r.json()["provisoire"]))
            time.sleep(random.uniform(0.15, 0.5))

        def revoir():
            ch.noter("joueurs revus", atelier.get("/api/joueurs"))
            time.sleep(0.1)

        def appareil_a():
            i = len(provs) - 1
            a.cookies.clear()
            t0 = time.monotonic()
            r = ch.noter("entrée au provisoire", a.post("/api/connexion", json={"identifiant": ident, "mot_de_passe": provs[i][2].upper().replace("-", " ")}))
            t1 = time.monotonic()
            if r.status_code == 200 and r.json().get("choisir"):
                entrees_a.append((t0, t1, i))
                mdp = f"mon mot de passe {random.randint(1, 10 ** 9)}"
                t2 = time.monotonic()
                r = ch.noter("mot de passe choisi", a.post("/api/compte", json={"mot_de_passe": mdp, "confirmation": mdp}))
                t3 = time.monotonic()
                if r.status_code == 200:
                    choisis.append((t2, t3, mdp, i))
                    t4 = time.monotonic()
                    sessions.append((t3, t4, a.get("/api/moi").status_code, len(choisis) - 1))
            time.sleep(0.02)

        def appareil_b():
            if not choisis:
                time.sleep(0.05)
                return
            k = len(choisis) - 1
            b.cookies.clear()
            t0 = time.monotonic()
            r = ch.noter("entrée au mot de passe", b.post("/api/connexion", json={"identifiant": ident, "mot_de_passe": choisis[k][2]}))
            if r.status_code == 200 and not r.json().get("choisir"):
                entrees_b.append((t0, time.monotonic(), k))
                t2 = time.monotonic()
                sessions.append((t2, t2, b.get("/api/moi").status_code, k))
            time.sleep(0.02)

        def lecteur():
            for f in (provisoires.fichier(config.PROPOSITIONS, eid), comptes.fichier(config.PROPOSITIONS, eid)):
                try:
                    json.loads(f.read_text(encoding="utf-8"))
                except FileNotFoundError:
                    pass
            time.sleep(0.005)

        bloques = ch.lancer({"le MJ": mj, "la carte des joueurs": revoir, "l'iPhone": appareil_a, "le Mac": appareil_b, "le lecteur": lecteur})
        assert not bloques, bloques
        assert not ch.erreurs, "\n".join(ch.erreurs[:5])
        assert choisis and entrees_b and len(provs) > 3, (ch.compte, len(provs))

        def refait_apres(i, depuis, avant):
            """Un provisoire plus récent que le n° i, commencé après depuis et écrit avant avant."""
            return any(t0 > depuis and t1 < avant for t0, t1, _ in provs[i + 1:])

        def refait_avant(i, avant):
            return any(t1 < avant for _, t1, _ in provs[i + 1:])

        fautes = [f"provisoire n° {i} accepté alors qu'un plus récent était écrit" for t0, _, i in entrees_a if refait_avant(i, t0)]
        fautes += [f"mot de passe choisi avec le provisoire n° {i} alors qu'un plus récent était écrit" for t2, _, _, i in choisis if refait_avant(i, t2)]
        fautes += [f"mot de passe n° {k} accepté après un nouveau provisoire" for t0, _, k in entrees_b
                   if refait_apres(choisis[k][3], choisis[k][1], t0)]
        fautes += [f"session du mot de passe n° {k} encore ouverte après un nouveau provisoire" for _, t4, statut, k in sessions
                   if statut == 200 and refait_apres(choisis[k][3], choisis[k][1], t4)]
        assert not fautes, fautes[:5]
        # Au repos, un seul secret ouvre : le dernier provisoire s'il n'a pas servi, sinon le dernier mot de passe choisi.
        c = TestClient(joueurs.app)
        compte = comptes.lire(config.PROPOSITIONS, eid)
        en_cours = provisoires.en_cours(config.PROPOSITIONS, eid, compte)
        ouvrent = []
        for i, (_, _, mot) in enumerate(provs):
            c.cookies.clear()
            if c.post("/api/connexion", json={"identifiant": ident, "mot_de_passe": mot}).status_code == 200:
                ouvrent.append(f"provisoire {i}")
        for k, (_, _, mdp, _) in enumerate(choisis):
            c.cookies.clear()
            if c.post("/api/connexion", json={"identifiant": ident, "mot_de_passe": mdp}).status_code == 200:
                ouvrent.append(f"mot de passe {k}")
        assert ouvrent == ([f"provisoire {len(provs) - 1}"] if en_cours else [f"mot de passe {len(choisis) - 1}"]), ouvrent
        print("gestes :", ch.compte, "provisoires :", len(provs))
    finally:
        atelier.delete(f"/api/joueurs/{eid}")
        patch.undo()


def test_vague_5_le_compte_principal_nait_une_fois(monde):
    """assurer_principal au démarrage et à chaque requête en ligne avec un cookie, en même temps : un seul principal, une
    seule naissance au journal, une seule génération de plus quand l'empreinte de l'environnement change ; le fichier
    toujours entier, en 0600, son dossier en 0700."""
    d = Path(tempfile.mkdtemp(prefix="mj-charge-"))
    lus, fautes = [], []

    def en_parallele(empreinte: str, n_fils=16, fois=30):
        def tourner():
            try:
                for _ in range(fois):
                    lus.append(comptes_mj.assurer_principal(d, empreinte))
                    try:
                        json.loads(comptes_mj.chemin(d).read_text(encoding="utf-8"))
                    except FileNotFoundError:
                        pass
            except Exception:
                fautes.append(traceback.format_exc())
        fils = [threading.Thread(target=tourner, daemon=True) for _ in range(n_fils)]
        for f in fils:
            f.start()
        for f in fils:
            f.join(60)
        assert not any(f.is_alive() for f in fils)

    def verifier(generation: int, gestes: list):
        assert not fautes, fautes[0]
        etat = json.loads(comptes_mj.chemin(d).read_text(encoding="utf-8"))
        principaux = [c for c in etat["comptes"] if c["role"] == "principal"]
        assert len(principaux) == 1 and principaux[0]["generation"] == generation, principaux
        assert oct(comptes_mj.chemin(d).stat().st_mode & 0o777) == "0o600"
        assert oct(comptes_mj.dossier(d).stat().st_mode & 0o777) == "0o700"
        journal = [json.loads(x)["geste"] for x in (comptes_mj.dossier(d) / comptes_mj.JOURNAL).read_text(encoding="utf-8").splitlines()]
        assert journal == gestes, journal
        assert not list(comptes_mj.dossier(d).glob(".*.tmp"))

    en_parallele("scrypt:1024:8:1:00:aa")
    verifier(1, ["principal-cree"])
    en_parallele("scrypt:1024:8:1:00:bb")
    verifier(2, ["principal-cree", "mot-de-passe-environnement"])

    # Par la Garde : chaque requête en ligne avec un cookie relit les comptes, pendant que le démarrage les assure.
    atelier = monde["atelier"]
    hote = "atelier-charge.example.ch"
    patch = pytest.MonkeyPatch()
    patch.setattr(portier, "ATELIER_PUBLIC", {hote})
    patch.setattr(portier, "HOTES", portier.HOTES | {hote})
    patch.setattr(portier, "EMPREINTE_MDP", "scrypt:1024:8:1:00:cc")
    patch.setattr(portier, "CLE_SESSION", b"cle-de-charge")
    dossier = comptes_mj.dossier(config.DONNEES)
    sauve = comptes_mj.chemin(config.DONNEES).read_bytes() if comptes_mj.chemin(config.DONNEES).exists() else None
    import shutil
    shutil.rmtree(dossier, ignore_errors=True)
    statuts, erreurs = [], []
    try:
        def requetes():
            try:
                for _ in range(15):
                    statuts.append(atelier.get("/api/moi", headers={"Host": hote, "Cookie": "__Host-arriere-salle=1.abc"}).status_code)
            except Exception:
                erreurs.append(traceback.format_exc())

        def demarrage():
            try:
                for _ in range(15):
                    portier.comptes_mj_lus()
            except Exception:
                erreurs.append(traceback.format_exc())
        fils = [threading.Thread(target=requetes, daemon=True) for _ in range(8)] + [threading.Thread(target=demarrage, daemon=True) for _ in range(4)]
        for f in fils:
            f.start()
        for f in fils:
            f.join(60)
        assert not erreurs, erreurs[0]
        assert set(statuts) == {401}, set(statuts)
        etat = json.loads(comptes_mj.chemin(config.DONNEES).read_text(encoding="utf-8"))
        assert [c["id"] for c in etat["comptes"] if c["role"] == "principal"] == ["alban"]
        assert oct(comptes_mj.chemin(config.DONNEES).stat().st_mode & 0o777) == "0o600"
        journal = [json.loads(x)["geste"] for x in (dossier / comptes_mj.JOURNAL).read_text(encoding="utf-8").splitlines()]
        assert journal == ["principal-cree"], journal
    finally:
        patch.undo()
        shutil.rmtree(dossier, ignore_errors=True)
        if sauve is not None:
            comptes.ecrire_prive(comptes_mj.chemin(config.DONNEES), json.loads(sauve))
        shutil.rmtree(d, ignore_errors=True)


# ---------------------------------------------------------------- vague 6 : dés d'aventure, portes, « Pour le MJ seulement »

PORTES_6 = [{"id": f"p{x}{y}", "sens": "v", "x": x, "y": y, "genre": "porte", "etat": "fermee"} for x in (2, 4, 6, 8) for y in (1, 2)]


def test_vague_6_reserve_portes_et_passages_confies_en_meme_temps(monde, espion):
    """Léa et Basile lancent des tests avec dé d'aventure (Léa dépense son avantage quand elle l'a, Basile jette aussi des
    dés libres) ; le Tableau annule des dés, annonce et retire des dés de mésaventure, passe des dés à la main, rend
    l'avantage d'Aude ; tous deux bougent sur un plan de cinq salles en enfilade, dont ils ouvrent les portes ; la boîte
    annule des pas (les portes se referment) ; l'éditeur du plan, sourd au canal, enregistre en retard ; Léa écrit et
    confie des passages au MJ, qui les lit pendant qu'il enregistre la fiche d'Aude. Puis, plus court, le Tableau règle le
    total pendant que tout continue.
    À la fin : chaque dé compté (réserve du MJ = départ + dés d'aventure joués - annulés - mésaventures roulées + passes à la
    main), chaque annulation une fois, le total toujours celui du réglage ; les portes et les pions tels que le journal des
    mouvements les dit, aucun 409 pour l'éditeur ni pour la fiche ; le dernier passage confié sur la fiche, aucun texte confié
    dans les files ; ni interblocage, ni ordre de prise inverse, ni 500."""
    atelier = monde["atelier"]
    lea_id, basile_id = monde["lea_id"], monde["basile_id"]
    aude = monde["heros_lea"]["id"]
    patch = pytest.MonkeyPatch()
    patch.setattr(commandes_api.confidences, "verrou", heros_etat.SAC_VERROU)
    patch.setattr(confie, "verrou", verrou_de_fichier_espionne(confie.verrou, "confie.verrou", espion))
    patch.setattr(demandes, "PAR_HEURE", 10_000)
    patch.setattr(jets_distance, "PAR_HEURE", 10_000)
    patch.setattr(jets_mj, "JETS_GARDES", 100_000)
    patch.setattr(mouvements, "GARDES", 100_000)
    patch.setattr(joueurs, "DEMANDES_FAITES", {})
    patch.setattr(joueurs, "JETS_LANCES", {})
    patch.setattr(joueurs, "DEPLACEMENTS_FAITS", {})
    canari = f"CONFIECHARGE{os.urandom(3).hex().upper()}"
    w, h = 10, 4
    with demandes.verrou(config.PROPOSITIONS):
        actions_coin.jets_mj.reserve.ecrire(reserve.normaliser({"actif": True, "groupe": 4, "mj": 0}))
    plan = atelier.post("/api/plans", json={
        "nom": "Plan des portes de charge", "lieu": "", "largeur": w, "hauteur": h, "m_case": 1.5, "brouillard_actif": True, "style": "couleur",
        "sol": [1] * (w * h), "piece": [1 + x // 2 for y in range(h) for x in range(w)], "brouillard": [1] * (w * h),
        "pieces": [{"id": i, "nom": f"Salle {i}", "genre": "salle"} for i in range(1, 6)], "portes": PORTES_6, "objets": [],
        "textes": [{"id": "t-mj", "texte": "Éditeur 0", "x": 5, "y": 0, "taille": 1}],
        "pions": [{"id": "t-aude", "genre": "heros", "nom": "Aude", "ref": f"aventurier:{aude}", "x": 0.5, "y": 0.5},
                  {"id": "t-bertrand", "genre": "heros", "nom": "Bertrand", "ref": f"aventurier:{monde['heros_basile']['id']}", "x": 9.5, "y": 3.5}]}).json()
    pid = plan["id"]
    deja = {x["id"] for x in actions_coin.jets_mj.lire_registre()["jets"]}
    try:
        assert atelier.put("/api/table", json={"vue": "plan", "plan": pid, "style": "couleur"}).status_code == 200
        tv_etat.table_coin.tout_de_suite()
        actions_coin.jets_mj.publier()
        assert calme_pour(lea_id) and calme_pour(basile_id)
        mj_depart = actions_coin.jets_mj.reserve.lire()["mj"]
        totaux = {"permis": {4}, "dernier": 4}
        passes = {"mj": 0, "groupe": 0}
        annules: dict[str, int] = {}
        fiche = {"notes": None, "409": 0}
        editeur = {"copie": atelier.get(f"/api/plans/{pid}").json(), "texte": "Éditeur 0", "409": 0}
        lus = []

        def phase(duree: float, regler: bool) -> Charge:
            ch = Charge(duree)

            def lance(coin, avec_des):
                j = ch.noter("jets lus", coin.get("/api/jets")).json()
                heros = j.get("heros") or {}
                lus.append((heros.get("reserve") or {}).get("aventure", 0) + (heros.get("reserve") or {}).get("mesaventure", 0))
                if avec_des and random.random() < 0.3:
                    ch.noter("dés libres", coin.post("/api/jets", json={"des": "2D6+1"}))
                else:
                    corps = {"carac": random.choice(["physique", "social", "mental"]), "competence": "", "modificateur": 0, "aventure": True}
                    if heros.get("jeton") == "avantage" and random.random() < 0.7:
                        corps["avantage"] = True
                    ch.noter("test avec dé d'aventure", coin.post("/api/jets", json=corps))
                time.sleep(0.05)

            def bouge(coin, pion):
                t = coin.get("/api/table").json()
                moi = next((x for x in ((t.get("vue") or {}).get("plan") or {}).get("pions") or [] if x["id"] == pion), None)
                if moi:
                    ici = [int(moi["x"] // 1), int(moi["y"] // 1)]
                    vers = [random.randint(0, w - 1), random.randint(0, h - 1)]
                    if vers != ici:
                        ch.noter("pas", coin.post("/api/demandes", json={"genre": "deplacement", "corps": {
                            "plan": t["vue"]["plan"]["id"], "pion": pion, "depuis": ici, "vers": vers}}))
                time.sleep(0.05)

            def tableau():
                v = ch.noter("Tableau lu", atelier.get("/api/jets")).json()
                r = v["reserve"]
                if r["groupe"] + r["mj"] not in totaux["permis"] or min(r["groupe"], r["mj"]) < 0:
                    ch.erreurs.append(f"réserve lue : {r}, totaux permis {totaux['permis']}")
                geste = random.random()
                # Le premier passage du Tableau d'une phase qui règle règle toujours : sur une machine chargée, 2,5 s ne
                # font parfois que cinq lectures, et le hasard seul n'en réglait aucune (une fois sur dix).
                if regler and (not ch.compte.get("total réglé") or random.random() < 0.35):
                    total = random.randint(3, 6)
                    totaux["permis"].add(total)
                    if ch.noter("total réglé", atelier.put("/api/des-aventure", json={"total": total})).status_code == 200:
                        totaux["dernier"] = total
                elif geste < 0.3:
                    for x in v["jets"]:
                        if (x.get("aventure") or {}) and not x["aventure"].get("annule"):
                            rep = ch.noter("dé annulé", atelier.post(f"/api/jets/{x['id']}/aventure/annuler"))
                            if rep.status_code == 200:
                                annules[x["id"]] = annules.get(x["id"], 0) + 1
                            break
                elif geste < 0.45:
                    ch.noter("mésaventure annoncée", atelier.post("/api/jets/mesaventure", json={"joueur": random.choice([lea_id, basile_id])}))
                elif geste < 0.55:
                    ch.noter("mésaventure retirée", atelier.post(f"/api/jets/mesaventure/{random.choice([lea_id, basile_id])}/retirer"))
                elif geste < 0.8:
                    vers = random.choice(["mj", "groupe"])
                    if ch.noter("dé passé", atelier.post("/api/des-aventure/passer", json={"vers": vers})).status_code == 200:
                        passes[vers] += 1
                elif geste < 0.9:
                    ch.noter("avantage rendu", atelier.patch(f"/api/etats-heros/{aude}", json={"avantage": "avantage"}))
                else:
                    ch.noter("interrupteur", atelier.put("/api/des-aventure", json={"actif": True}))
                time.sleep(0.05)

            def boite():
                v = atelier.get("/api/demandes").json()
                # Un pas qui a ouvert une porte s'annule presque toujours (la porte se referme), les autres parfois.
                for x in v["historique"][:6]:
                    if x.get("annulable") and x["genre"] == "deplacement" and random.random() < (0.9 if "ouvre" in (x.get("phrase") or "") else 0.2):
                        ch.noter("pas annulé", atelier.post(f"/api/demandes/{x['joueur']}/{x['id']}/annuler", json={"version": x["version"]}))
                time.sleep(0.1)

            def editeur_sourd():
                p = editeur["copie"]
                texte = f"Éditeur {random.randint(1, 10 ** 6)}"
                next(t for t in p["textes"] if t["id"] == "t-mj")["texte"] = texte
                r = ch.noter("éditeur", atelier.put(f"/api/plans/{pid}", json={**p, "version_base": p["modifie"]}))
                if r.status_code == 200:
                    editeur["texte"] = texte
                    editeur["copie"] = {k: v for k, v in r.json().items() if k != "rejoues"}
                elif r.status_code == 409:
                    editeur["409"] += 1
                    editeur["copie"] = atelier.get(f"/api/plans/{pid}").json()
                time.sleep(0.12)

            def lea_confie():
                n = random.randint(1, 10 ** 6)
                ch.noter("brouillon", monde["lea"].put("/api/confie", json={"texte": f"Brouillon {n}."}))
                ch.noter("passage confié", monde["lea"].post("/api/confie/envoyer", json={"texte": f"Passage {n}, {canari}."}))
                time.sleep(0.1)

            def mj_lit():
                f = atelier.get(f"/api/aventuriers/{aude}").json()
                c = f.get(confie.CHAMP)
                if c and not c.get("lu"):
                    r = ch.noter("lu", atelier.post(f"/api/aventuriers/{aude}/confie/lu", json={"envoi": c["envoi"]}))
                    if r.status_code not in (200, 409):
                        ch.erreurs.append(f"lu : {r.status_code} {r.text[:200]}")
                # La fiche part entière, avec ce qu'elle a lu de confié au MJ : le serveur garde le sien (champ protégé).
                n = f"Notes de la vague 6 {random.randint(1, 10 ** 6)}"
                r = ch.noter("fiche enregistrée", atelier.put(f"/api/aventuriers/{aude}", json={**f, "notes_mj": n, "version_base": f["modifie"]}))
                if r.status_code == 200:
                    fiche["notes"] = n
                elif r.status_code == 409:
                    fiche["409"] += 1
                time.sleep(0.1)

            def lecteurs():
                for url in (f"/api/plans/{pid}/deplacements", "/api/demandes"):
                    ch.noter("lectures", atelier.get(url))
                for coin in (monde["lea"], monde["basile"]):
                    ch.noter("lectures du coin", coin.get("/api/confie" if coin is monde["lea"] else "/api/table"))
                time.sleep(0.05)

            bloques = ch.lancer({"Léa lance": lambda: lance(monde["lea"], False), "Basile lance": lambda: lance(monde["basile"], True),
                                 "Léa bouge": lambda: bouge(monde["lea"], "t-aude"), "Basile bouge": lambda: bouge(monde["basile"], "t-bertrand"),
                                 "le Tableau": tableau, "la boîte": boite, "l'éditeur": editeur_sourd, "Léa confie": lea_confie,
                                 "le MJ lit": mj_lit, "les lecteurs": lecteurs})
            assert not bloques, f"fils restés bloqués (interblocage ?) : {bloques}"
            assert not ch.erreurs, "\n".join(ch.erreurs[:5])
            assert calme_pour(lea_id, 20) and calme_pour(basile_id, 20)
            return ch

        retard = {"max": 0.0, "fin": False}

        async def sonde():
            while not retard["fin"]:
                avant = time.monotonic()
                await asyncio.sleep(0.02)
                retard["max"] = max(retard["max"], time.monotonic() - avant - 0.02)

        atelier.portal.start_task_soon(sonde)
        ch = phase(DUREE, regler=False)
        for geste in ("test avec dé d'aventure", "dés libres", "dé annulé", "mésaventure annoncée", "dé passé", "pas", "pas annulé",
                      "éditeur", "passage confié", "lu", "fiche enregistrée"):
            assert ch.compte.get(geste, 0) > 0, f"rien n'a été essayé pour « {geste} » : {ch.compte}"
        # Chaque dé compté : sans réglage du total, la réserve du MJ ne bouge que par ces gestes-là.
        nouveaux = [x for x in actions_coin.jets_mj.lire_registre()["jets"] if x["id"] not in deja]
        joues = sum(1 for x in nouveaux if x.get("aventure"))
        rendus = sum(1 for x in nouveaux if (x.get("aventure") or {}).get("annule"))
        mesaventures = sum(1 for x in nouveaux if x.get("mesaventure"))
        r = actions_coin.jets_mj.reserve.lire()
        assert joues and rendus and mesaventures, (joues, rendus, mesaventures)
        assert r["mj"] == mj_depart + joues - rendus - mesaventures + passes["mj"] - passes["groupe"], (r, joues, rendus, mesaventures, passes)
        assert reserve.total(r) == 4
        assert all(n == 1 for n in annules.values()) and len(annules) == rendus, annules
        assert set(lus) <= {0, 4}, sorted(set(lus))
        # Les portes et les pions : ce que dit le journal des mouvements, rejoué depuis le plan de départ.
        p = atelier.get(f"/api/plans/{pid}").json()
        journal = tv_etat.mouvements_joueurs.lire_journal(pid)
        assert journal and any(m.get("portes") for m in journal) and any(m["genre"] == "annulation" and m.get("portes") for m in journal)
        attendu = {(d["sens"], d["x"], d["y"]): "fermee" for d in PORTES_6}
        for m in journal:
            for c in m.get("portes") or []:
                assert attendu[(c["sens"], c["x"], c["y"])] == c["avant"], (m, attendu)
                attendu[(c["sens"], c["x"], c["y"])] = c["apres"]
        assert {(d["sens"], d["x"], d["y"]): d["etat"] for d in p["portes"]} == attendu
        for pion in ("t-aude", "t-bertrand"):
            dernier = [m for m in journal if m.get("pion") == pion]
            if dernier:
                t = next(t for t in p["pions"] if t["id"] == pion)
                assert [t["x"], t["y"]] == dernier[-1]["apres"], pion
        assert editeur["409"] == 0, f"{editeur['409']} conflit(s) inutile(s) pour l'éditeur"
        assert next(t for t in p["textes"] if t["id"] == "t-mj")["texte"] == editeur["texte"]
        # Le dernier passage confié est sur la fiche, avec les notes du dernier enregistrement ; aucun texte dans les files.
        f = atelier.get(f"/api/aventuriers/{aude}").json()
        envoye = confie.lire(config.PROPOSITIONS, lea_id)["envoye"]
        assert envoye and f[confie.CHAMP]["envoi"] == envoye["id"] and f[confie.CHAMP]["texte"] == envoye["texte"]
        assert fiche["409"] == 0 and f["notes_mj"] == fiche["notes"]
        for jid in (lea_id, basile_id):
            assert canari not in demandes.fichier(config.PROPOSITIONS, jid).read_text(encoding="utf-8")
        assert canari not in atelier.get("/api/demandes").text
        # Puis le Tableau règle le total pendant que tout continue : il tient, toujours l'un des totaux réglés.
        ch2 = phase(2.5, regler=True)
        assert ch2.compte.get("total réglé", 0) > 0, ch2.compte
        r = actions_coin.jets_mj.reserve.lire()
        assert reserve.total(r) == totaux["dernier"] and min(r["groupe"], r["mj"]) >= 0, (r, totaux)
        retard["fin"] = True
        assert retard["max"] < 1.5, f"la boucle de l'atelier est restée prise {retard['max']:.2f} s"
        assert not espion.reprises, espion.reprises[0]
        cycles = espion.cycles()
        assert not cycles, "ordres de prise inverses : " + "; ".join(" → ".join(c) for c in cycles) + "\n" + "\n".join(
            f"{a} puis {b} :\n{ou}" for (a, b), ou in espion.aretes.items() if any(a in c and b in c for c in cycles))
        assert ("demandes.verrou", "SAC_VERROU") in espion.aretes and ("confie.verrou", "demandes.verrou") in espion.aretes
        print("gestes :", ch.compte, ch2.compte, "arêtes :", sorted(espion.aretes), f"retard de la boucle : {retard['max'] * 1000:.0f} ms")
    finally:
        retard_fin = locals().get("retard")
        if retard_fin:
            retard_fin["fin"] = True
        patch.undo()
        atelier.put("/api/table", json={"vue": "plan", "plan": monde["plan"]["id"], "style": "couleur"})
        tv_etat.table_coin.tout_de_suite()
        atelier.delete(f"/api/plans/{pid}")
        atelier.patch(f"/api/etats-heros/{aude}", json={"avantage": None})
        actions_coin.jets_mj.reserve.fichier.unlink(missing_ok=True)
        with confie.verrou(config.PROPOSITIONS):
            confie.fichier(config.PROPOSITIONS, lea_id).unlink(missing_ok=True)
        confie.fichier_recu(config.PROPOSITIONS, lea_id).unlink(missing_ok=True)
        with heros_etat.SAC_VERROU:
            f = utilitaires.lire(config.AVENTURIERS / f"{aude}.json")
            f.pop(confie.CHAMP, None)
            utilitaires.ecrire(config.AVENTURIERS / f"{aude}.json", f)
        actions_coin.jets_mj.publier()


def test_aucune_fonction_async_n_attend_sous_un_verrou_de_fil():
    """Un `await` sous un `with` de verrou de fil laisserait la boucle passer à une autre requête qui reprendrait le même
    verrou (RLock : sans rien attendre, dans le même fil) au milieu de l'écriture ; un Lock bloquerait toute la boucle."""
    fautes = []
    for f in sorted(APP.rglob("*.py")):
        arbre = ast.parse(f.read_text(encoding="utf-8"))
        for fn in ast.walk(arbre):
            if not isinstance(fn, ast.AsyncFunctionDef):
                continue
            for w in ast.walk(fn):
                if isinstance(w, ast.With) and any(isinstance(n, ast.Await) for b in w.body for n in ast.walk(b)):
                    quoi = [ast.unparse(i.context_expr) for i in w.items]
                    if quoi != ["tempfile.TemporaryDirectory(prefix='pdf-')"]:
                        fautes.append(f"{f.name}:{w.lineno} {fn.name} : {quoi}")
    assert not fautes, fautes


def test_aucun_verrou_de_fil_sous_async_with():
    """« async with » ne vaut que pour un verrou de la boucle (asyncio.Lock, Semaphore) : sur un verrou de fil, il
    échouerait, ou pire, sur un verrou de fil maison, bloquerait la boucle entière."""
    import re

    fils = set()
    for f in sorted(APP.rglob("*.py")):
        fils |= set(re.findall(r"(\w+)\s*=\s*threading\.R?Lock\(\)", f.read_text(encoding="utf-8")))
    assert {"SAC_VERROU", "VERROU_SANCTUAIRE", "PUBLICATION", "verrou"} <= fils
    fautes = []
    for f in sorted(APP.rglob("*.py")):
        for n in ast.walk(ast.parse(f.read_text(encoding="utf-8"))):
            if isinstance(n, ast.AsyncWith):
                for i in n.items:
                    nom = ast.unparse(i.context_expr).split(".")[-1].split("(")[0]
                    if nom in fils:
                        fautes.append(f"{f.name}:{n.lineno} async with {ast.unparse(i.context_expr)}")
    assert not fautes, fautes


def test_l_espion_voit_un_ordre_inverse_et_une_reprise():
    """L'espion lui-même : deux chemins qui prennent A puis B, et B puis A (l'un après l'autre, sans s'attendre), font un
    cycle ; un verrou de fichier repris par son propre fil est vu."""
    e = Espion()
    a = VerrouEspionne(threading.Lock(), "A", e, False)
    b = VerrouEspionne(threading.RLock(), "B", e, True)
    with a, b:
        pass
    with b:
        with b, a:
            pass
    assert e.cycles() and not e.reprises

    @contextmanager
    def fichier():
        yield

    f = verrou_de_fichier_espionne(fichier, "F", e)
    with f():
        with f():
            pass
    assert e.reprises and "F repris" in e.reprises[0]
