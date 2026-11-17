"""Le sanctuaire des joueurs dans l'atelier : la section « sanctuaire » du carnet, et ce que la boîte du MJ fait
des versements et des projets demandés depuis le coin (cagnottes.py).

- La section : rien tant que le MJ cache le sanctuaire aux joueurs ; sinon le village tel que la TV le montre
  (sanctuaire_public : ni notes du MJ, ni bâtiment caché, ni journal, des versements les seuls prénoms) et les projets
  qu'il coche, passés au masque puis à la détection des inconnus jusque dans leurs niveaux. Bâtiments et projets n'y
  sont que des jetons opaques : l'identifiant d'un bâtiment (« maison-3 ») dirait combien d'autres sont cachés.
- « versement » et « projet » attendent le MJ. À l'acceptation, les cœurs des routes du sanctuaire (main.py :
  verser_au_sanctuaire, ouvrir_chantier) font le geste sous le verrou du sanctuaire, la bourse revérifiée ; la fiche
  « Mon héros » et la section sont republiées avant que le statut ne parte. Un refus de l'atelier ne va qu'au MJ : le
  joueur ne lit que ce que le MJ décide.
- Ensuite, dans la boucle (apres) : le journal de la séance en cours, comme l'onglet Sanctuaire l'écrit après un
  versement ; la TV qui montre le sanctuaire ; les pages de l'atelier (message {"type": "sac", "sanctuaire": vrai}).

Ce module ne connaît de l'atelier que les fonctions que main.py lui passe.
"""
import logging
import re
from datetime import date, datetime
from typing import Awaitable, Callable

from fastapi import HTTPException

from commun import cagnottes  # noqa: F401 (les genres « versement » et « projet » s'enregistrent à l'import)
from commun import demandes
from contenu import sanctuaire
from commun.demandes import Refus
from table.masque import masquer, masquer_tout, secrets_dans

journal = logging.getLogger("atelier.sanctuaire")

# Ce qui n'est jamais un texte lisible dans un élément de la section.
NON_TEXTE = frozenset({"id", "genre", "forme", "toit", "embleme"})
CHAMPS = {"nom": "nom", "etat": "état", "bonus": "bonus", "description": "description", "accroche": "accroche"}
ARTICLE = re.compile(r"^(Le|La|Les|L['’]|Un|Une|Des)\b")


def prenom(nom) -> str:
    mots = re.split(r"[\s,]+", nom.strip()) if isinstance(nom, str) else []
    return mots[0] if mots and mots[0] else ""


def en_phrase(nom: str) -> str:
    """« la forge » pour « La forge » : un nom de bâtiment au milieu d'une phrase."""
    return ARTICLE.sub(lambda m: m.group(1).lower(), nom or "", count=1)


# ---------------------------------------------------------------- la séance en cours (portage de seance-en-cours.js)

def _instant(iso) -> float:
    try:
        t = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return 0.0
    return t.timestamp()


def _jour_de(iso) -> str:
    try:
        t = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return ""
    return (t.astimezone() if t.tzinfo else t).date().isoformat()


def _numero(s: dict) -> float:
    v = s.get("numero")
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else 0.0


def jouee(s: dict, jour: str) -> float:
    t = 0.0
    for d in s.get("deroule") or []:
        q = d.get("en_cours") if isinstance(d, dict) and isinstance(d.get("en_cours"), str) else ""
        if q and _jour_de(q) == jour:
            t = max(t, _instant(q))
    return t


def seance_en_cours(seances: list, jour: str | None = None) -> dict | None:
    """La séance où noter, par la règle unique de l'atelier (js/seances/seance-en-cours.js) : celle d'un combat en cours, sinon
    celle dont une scène a été jouée ce jour-là, sinon la plus proche par sa date, sinon la première sans date ; parmi
    les séances non closes, à égalité la plus petite par son numéro."""
    jour = jour or date.today().isoformat()
    ouvertes = sorted((s for s in seances or [] if isinstance(s, dict) and not s.get("close")), key=_numero)
    if not ouvertes:
        return None

    def plus_recente(liste, quand):
        meilleure = liste[0]
        for s in liste[1:]:
            if quand(s) > quand(meilleure):
                meilleure = s
        return meilleure

    au_combat = [s for s in ouvertes if isinstance(s.get("combat"), (dict, list))]
    if au_combat:
        return plus_recente(au_combat, lambda s: _instant(s["combat"].get("modifie") or s["combat"].get("debut"))
                            if isinstance(s["combat"], dict) else 0.0)
    jouees = [s for s in ouvertes if jouee(s, jour)]
    if jouees:
        return plus_recente(jouees, lambda s: jouee(s, jour))
    datees = [s for s in ouvertes if isinstance(s.get("date"), str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", s["date"])]
    if not datees:
        return ouvertes[0]
    ref = date.fromisoformat(jour)
    choisie, ecart = None, None
    for s in datees:
        d = abs((date.fromisoformat(s["date"]) - ref).days)
        if ecart is None or d < ecart:
            choisie, ecart = s, d
    return choisie


# ---------------------------------------------------------------- la section du carnet

def retenir_partout(element: dict, essentiel: str, quoi: str, candidats: list, retenus: list, noms_secrets) -> dict | None:
    """Comme retenir (main.py), jusque dans les objets et les listes imbriqués (le prochain niveau, les niveaux d'un
    projet, les bonus) : un texte qui nomme un inconnu des joueurs s'efface ; le champ essentiel (le nom) retient
    l'élément entier. Le MJ lit ce qui est retenu dans l'onglet Aventuriers, avec le reste du carnet."""
    principal = element.get(essentiel)
    if isinstance(principal, str) and (trouves := secrets_dans(principal, candidats)):
        retenus.append(f"{quoi} : absent du carnet, il nomme {noms_secrets(trouves)}.")
        return None

    def propre(v, cle):
        if isinstance(v, str):
            trouves = secrets_dans(v, candidats)
            if trouves:
                retenus.append(f"{quoi} : {CHAMPS.get(cle, cle)} retenu, il nomme {noms_secrets(trouves)}.")
                return ""
            return v
        if isinstance(v, dict):
            return {k: x if k in NON_TEXTE else propre(x, k) for k, x in v.items()}
        if isinstance(v, list):
            return [propre(x, cle) for x in v]
        return v

    return propre(element, "")


def section(s: dict, jeton: Callable[[str, str], str], candidats: list, retenus: list, noms_secrets) -> list | None:
    """La section « sanctuaire » du carnet ; None quand le MJ cache le sanctuaire aux joueurs. Un élément pour le village
    (nom, accroche, habitants, bonus gagnés), un par bâtiment montré, un par projet ouvert, chacun au masque."""
    vu = sanctuaire.pour_les_joueurs(s)
    if vu is None:
        return None
    pub, garde = vu["public"], set()
    batiments = []
    for b in pub["batiments"]:
        element = masquer_tout({"genre": "batiment", **{k: v for k, v in b.items() if k != "id"}, "id": jeton("sanctuaire", b["id"])})
        propre = retenir_partout(element, "nom", f"Le bâtiment « {b.get('nom')} » du sanctuaire", candidats, retenus, noms_secrets)
        if propre is not None:
            batiments.append(propre)
            garde.add(b["id"])
    # Les bonus gagnés, sans les bâtiments retenus : rien ne parle d'un bâtiment que le village ne montre pas.
    bonus = [{"batiment": x["batiment"], "niveau": x["niveau"], "nom": x["nom"], "bonus": x["bonus"]} for x in pub["bonus"] if x.get("id") in garde]
    village = masquer_tout({"genre": "village", "nom": pub["nom"], "accroche": pub["accroche"], "habitants": pub["habitants"], "bonus": bonus})
    village = retenir_partout(village, "", "Le sanctuaire", candidats, retenus, noms_secrets)
    village["nom"] = village["nom"] or "Le sanctuaire"
    village["bonus"] = [x for x in village["bonus"] if x["bonus"] and x["batiment"]]
    projets = []
    for t in vu["projets"]:
        element = masquer_tout({"genre": "projet", **{k: v for k, v in t.items() if k != "type"}, "id": jeton("sanctuaire-type", t["type"])})
        propre = retenir_partout(element, "nom", f"Le projet « {t.get('nom')} » du sanctuaire", candidats, retenus, noms_secrets)
        if propre is not None:
            projets.append(propre)
    return [village, *batiments, *projets]


# ---------------------------------------------------------------- la boîte du MJ

class Chantiers:
    def __init__(self, *, lire: Callable[[], dict], empreinte: Callable[[], object], verser: Callable, ouvrir: Callable, jeton: Callable[[str, str], str],
                 heros_du_joueur: Callable, sac_de: Callable, candidats: Callable[[], list], publier_heros: Callable[[set], object],
                 publier_section: Callable[[], object], noter_seance: Callable[[list], None],
                 annoncer: Callable[[], Awaitable[None]], signaler: Callable[[dict], Awaitable[None]]):
        self.lire = lire
        self.empreinte = empreinte
        self.verser = verser
        self.ouvrir = ouvrir
        self.jeton = jeton
        self.heros_du_joueur = heros_du_joueur
        self.sac_de = sac_de
        self.candidats = candidats
        self.publier_heros = publier_heros
        self.publier_section = publier_section
        self.noter_seance = noter_seance
        self.annoncer = annoncer
        self.signaler = signaler
        self.cache = (None, None)
        # demande → ce qu'il reste à faire dans la boucle : les lignes du journal de la séance, les héros touchés.
        self.suites: dict[str, dict] = {}

    def brancher(self, boite) -> None:
        boite.brancher("versement", accepter=self.accepter_versement, apres=self.apres, dire=self.dire)
        boite.brancher("projet", accepter=self.accepter_projet, apres=self.apres, dire=self.dire)

    # ------------------------------------------------------------ retrouver par le jeton

    def sanctuaire(self, frais: bool = False) -> dict:
        """Le sanctuaire, relu seulement quand son fichier a changé : la boîte se dessine souvent, ligne par ligne."""
        cle, s = self.cache
        maintenant = self.empreinte()
        if frais or s is None or cle != maintenant or maintenant is None:
            s = self.lire()
            self.cache = (maintenant, s)
        return s

    def batiment(self, s: dict, ref: str) -> dict | None:
        return next((b for b in s.get("batiments", []) if isinstance(b.get("id"), str) and self.jeton("sanctuaire", b["id"]) == ref), None)

    def type_(self, s: dict, ref: str) -> dict | None:
        return next((t for t in s.get("catalogue", []) if isinstance(t.get("type"), str) and self.jeton("sanctuaire-type", t["type"]) == ref), None)

    def pour_le_joueur(self, nom: str, defaut: str) -> str:
        """Un nom de l'atelier dans une phrase lue par le joueur : au masque, et jamais s'il nomme un inconnu."""
        vu = masquer(nom or "")
        return defaut if not vu or secrets_dans(vu, self.candidats()) else vu

    def republier(self, heros: set) -> None:
        """La fiche « Mon héros » et la section du sanctuaire, avant que le statut ne parte : quand le joueur lit « accepté »,
        sa bourse et la cagnotte sont déjà à jour. Une publication manquée se rattrape au passage suivant du carnet."""
        try:
            if heros:
                self.publier_heros(heros)
            self.publier_section()
        except Exception:
            journal.exception("Carnet non republié après un geste du sanctuaire")

    # ------------------------------------------------------------ accepter

    def accepter_versement(self, j: dict, d: dict, _mot: str) -> str:
        corps = d["corps"]
        a = self.heros_du_joueur(j["id"])
        if not a:
            raise Refus(409, "Le héros de ce joueur n'est plus à la tablée : refusez ce versement.")
        b = self.batiment(self.sanctuaire(frais=True), corps["batiment"])
        if not b:
            raise Refus(409, "Ce chantier n'est plus au sanctuaire : refusez ce versement.")
        try:
            r = self.verser(b["id"], a["id"], corps["or"])
        except HTTPException as err:
            if err.status_code == 404:
                raise Refus(409, "Ce chantier ou ce héros n'est plus dans l'atelier : refusez ce versement.")
            raise Refus(409, f"{err.detail} Refusez ce versement, ou changez la bourse d'abord.")
        self.cache = (None, None)
        self.suites[d["id"]] = {"lignes": r["lignes"], "heros": {a["id"]}}
        self.republier({a["id"]})
        nom = self.pour_le_joueur(b.get("nom"), "ce chantier")
        n = r["construit"]
        if not r["pris"]:
            return f"Ce niveau était déjà payé : votre MJ a bâti {en_phrase(nom)}, votre bourse n'a pas bougé."
        phrases = [f"{r['pris']} po versées pour {en_phrase(nom)}."]
        if r["pris"] < corps["or"]:
            phrases.append(f"Il n'en manquait que {r['pris']} : les {corps['or'] - r['pris']} autres restent dans votre bourse.")
        if n:
            phrases.append(f"{nom[:1].upper()}{nom[1:]} passe au niveau {n['rang']} : {self.pour_le_joueur(n.get('nom'), 'un niveau de plus')}.")
        return " ".join(phrases)

    def accepter_projet(self, j: dict, d: dict, _mot: str) -> str:
        corps = d["corps"]
        s = self.sanctuaire(frais=True)
        t = self.type_(s, corps["type"])
        if not t:
            raise Refus(409, "Ce type de bâtiment n'est plus au catalogue : refusez ce projet.")
        if s.get("joueurs") is not True or t.get("joueurs") is not True:
            raise Refus(409, f"« {t.get('nom')} » n'est plus proposé aux joueurs : cochez-le dans le catalogue du sanctuaire, ou refusez ce projet.")
        cache = next((b for b in s.get("batiments", []) if b.get("type") == t["type"] and b.get("cache")), None)
        if t.get("unique") and cache:
            raise Refus(409, f"« {cache.get('nom') or t.get('nom')} » est déjà au sanctuaire, caché aux joueurs : décochez « Caché » "
                             "dans l'onglet Sanctuaire, ou refusez ce projet.")
        qui = j.get("nom") or "un joueur"
        try:
            _, b = self.ouvrir(t["type"], False, f" (proposé par {qui})")
        except HTTPException as err:
            raise Refus(409, f"{err.detail} Refusez ce projet.")
        self.cache = (None, None)
        self.suites[d["id"]] = {"lignes": [], "heros": set()}
        self.republier(set())
        return f"Chantier ouvert : {self.pour_le_joueur(b.get('nom'), 'le nouveau bâtiment')}. Votre MJ lui choisit sa place au village."

    async def apres(self, liste: list) -> None:
        """Après un « Accepter » du MJ, dans la boucle : le journal de la séance, la TV, les pages de l'atelier."""
        lignes, heros, fait = [], set(), False
        for _, d in liste:
            suite = self.suites.pop(d.get("id"), None)
            if suite:
                fait = True
                lignes += suite["lignes"]
                heros |= suite["heros"]
        if not fait:
            return
        if lignes:
            try:
                self.noter_seance(lignes)
            except Exception:
                journal.exception("Versement non noté au journal de la séance")
        await self.annoncer()
        await self.signaler({"type": "sac", "heros": sorted(heros), "sanctuaire": True})

    # ------------------------------------------------------------ la ligne de la boîte

    def dire(self, j: dict, d: dict) -> str:
        """« Sacha verse 30 po pour l'auberge (sa bourse : 85 po) », « Camille propose : la forge »."""
        c = d.get("corps") or {}
        qui = j.get("nom") or "Le joueur"
        s = self.sanctuaire()
        statut = d.get("statut")
        if d.get("genre") == "versement":
            b = self.batiment(s, c.get("batiment"))
            pour = en_phrase(b.get("nom")) if b else "un chantier retiré du village"
            montant = c.get("or", 0)
            if statut == demandes.EN_ATTENTE:
                # Ce qui attend le MJ dit la bourse du moment : il tranche sans aller la chercher.
                a = self.heros_du_joueur(j.get("id", ""))
                bourse = f" (sa bourse : {self.sac_de(a, 'or') or 0} po)" if a else " (son héros n'est plus à la tablée)"
                return f"{qui} verse {montant} po pour {pour}{bourse}"
            return f"{qui} {'a versé' if statut == demandes.ACCEPTEE else 'voulait verser'} {montant} po pour {pour}"
        if d.get("genre") == "projet":
            t = self.type_(s, c.get("type"))
            quoi = en_phrase(t.get("nom")) if t else "un bâtiment retiré du catalogue"
            mot = f", « {c['mot']} »" if c.get("mot") else ""
            if statut == demandes.EN_ATTENTE:
                premier = (t or {}).get("niveaux") or []
                cout = f" (niveau I : {premier[0].get('cout', 0)} po)" if premier else ""
                return f"{qui} propose : {quoi}{cout}{mot}"
            return f"{qui} {'a proposé' if statut == demandes.ACCEPTEE else 'proposait'} : {quoi}{mot}"
        return ""

