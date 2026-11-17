"""« Pour le MJ seulement » (lot C4, confie.py, confie_mj.py) : au bas de l'histoire de son héros, le joueur confie au MJ
ce que lui seul doit savoir. Pas de validation : « Envoyer au MJ » le dépose sur la fiche du héros (confie_au_mj), le MJ
le lit dans la page « Pour le MJ » de la fiche et le marque « Lu » ; le joueur relit ce qu'il a confié, voit s'il est lu,
le complète ou le remplace. Un brouillon par joueur, que lui seul lit.

Et surtout les fuites : un texte canari confié par Capucine ne paraît nulle part ailleurs que dans l'atelier du MJ et
dans la page de Capucine. Ni dans le coin de Dorian, ni dans les autres réponses du coin de Capucine, ni dans les
propositions hors de son propre fichier, ni à la TV ou à la table publique, ni dans « Voir comme un joueur », ni dans ce
que reçoit le faux modèle de l'aide à l'écriture (pour elle comme pour lui), ni dans les contextes de rédaction du MJ, ni
dans la boîte des demandes, ni dans Telegram, ni dans les journaux. Et personne ne lit ni n'écrit celui d'un autre en
forgeant sa requête."""
import asyncio
import json
import logging
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from starlette.routing import Mount  # noqa: E402

from mj import acces_mj  # noqa: E402
from commun import aide  # noqa: E402
from coin_mj import boite as boite_mod  # noqa: E402
from commun import confie  # noqa: E402
from commun import demandes  # noqa: E402
from commun import flux_coin  # noqa: E402
import joueurs  # noqa: E402
from commun import lore  # noqa: E402
from mj import proprietes  # noqa: E402
from ia import redaction  # noqa: E402
from comptes_coin import entrer  # noqa: E402
from faux_modele import FauxClient  # noqa: E402
import main  # noqa: E402
from api import application, carnet_api, commandes_api, config, contexte_du_modele, heros_etat, joueurs_mj, portier, tv_ecran, utilitaires  # noqa: E402

CANARI = "CANARIX7Q4Z"
TEXTE = f"Ombeline est la fille cachée du baron. {CANARI}. Pas d'araignées à la table, s'il vous plaît."
PROPOSITION = json.dumps({"genre": "suite", "note": "Une suite.", "texte": "Au matin, elle reprit la route."}, ensure_ascii=False)
# Ce que le coin ne lit pas comme une page : le flux (il ne se referme pas) et le PDF (Chromium).
IGNOREES_COIN = {"/api/flux", "/fiche.pdf"}


@pytest.fixture(scope="module")
def atelier():
    # L'ouvrier de l'aide à l'écriture ne tourne pas ici : l'essai de fuite fait passer les aides lui-même.
    patch = pytest.MonkeyPatch()

    async def sans_ouvrier():
        return None

    patch.setattr(commandes_api.aides_joueurs, "ouvrier", sans_ouvrier)
    with TestClient(application.app) as c:
        yield c
    patch.undo()


@pytest.fixture(scope="module")
def tablee(atelier):
    """Capucine (Ombeline) et Dorian (Gaspard) à la tablée, le carnet ouvert. Tout est retiré à la fin."""
    patch = pytest.MonkeyPatch()
    patch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    patch.setattr(joueurs, "COOKIE_SUR", False)
    patch.setattr(joueurs, "HOTES", set())
    patch.setattr(joueurs, "DEMANDES_FAITES", {})
    patch.setattr(joueurs, "AIDES_FAITES", {})
    t = {}
    for code, nom, heros, genre in (("c", "Capucine", "Ombeline Vasselin", "f"), ("d", "Dorian", "Gaspard Lenoir", "h")):
        invite = atelier.post("/api/joueurs", json={"nom": nom}).json()
        coin = TestClient(joueurs.app)
        entrer(coin, invite)
        coin.post("/api/moi/aventurier", json={"nom": heros, "genre": genre, "sante": 9, "psy": 5, "histoire": "Née sous la pluie.",
                                               "allure": "Grande, une cicatrice.", "equipement": ["Cape"], "objets": ["", "", ""]})
        coin.post("/api/moi/envoyer")
        fiche = atelier.post(f"/api/joueurs/{invite['id']}/accueillir").json()
        t[code] = {"joueur": invite, "coin": coin, "heros": fiche}
    avant = carnet_api.carnet_ouvert()
    atelier.put("/api/carnet-joueurs", json={"ouvert": True})
    carnet_api.publier_carnet()
    yield t
    for code in ("c", "d"):
        t[code]["coin"].close()
        atelier.delete(f"/api/joueurs/{t[code]['joueur']['id']}")
        atelier.delete(f"/api/aventuriers/{t[code]['heros']['id']}")
    atelier.put("/api/carnet-joueurs", json={"ouvert": avant})
    demandes.ecrire_pause(config.PROPOSITIONS, False)
    patch.undo()


@pytest.fixture()
def neuf(atelier, tablee):
    """Chaque essai part sans brouillon, sans demande, sans reçu ni texte confié sur les fiches, plafond horaire vide."""
    for code in ("c", "d"):
        j = jid(tablee, code)
        with confie.verrou(config.PROPOSITIONS):
            confie.fichier(config.PROPOSITIONS, j).unlink(missing_ok=True)
        confie.fichier_recu(config.PROPOSITIONS, j).unlink(missing_ok=True)
        with demandes.verrou(config.PROPOSITIONS):
            demandes.fichier(config.PROPOSITIONS, j).unlink(missing_ok=True)
        chemin = config.AVENTURIERS / f"{tablee[code]['heros']['id']}.json"
        with heros_etat.SAC_VERROU:
            f = utilitaires.lire(chemin)
            f.pop(confie.CHAMP, None)
            utilitaires.ecrire(chemin, f)
    joueurs.DEMANDES_FAITES.clear()
    joueurs.AIDES_FAITES.clear()
    demandes.ecrire_pause(config.PROPOSITIONS, False)
    carnet_api.publier_carnet()
    tablee["atelier"] = atelier
    yield tablee


def jid(t, code) -> str:
    return t[code]["joueur"]["id"]


def coin(t, code):
    return t[code]["coin"]


def etat(t, code) -> dict:
    r = coin(t, code).get("/api/confie")
    assert r.status_code == 200, r.text
    return r.json()


def ecrire(t, code, texte):
    return coin(t, code).put("/api/confie", json={"texte": texte})


def envoyer(t, code, texte=TEXTE):
    return coin(t, code).post("/api/confie/envoyer", json={"texte": texte})


def appliquer():
    """Une vague de la boîte : ce qui s'applique seul (la tâche de fond le fait aussi, sous le même verrou)."""
    commandes_api.boite.appliquer_tout()


def fiche(t, code) -> dict:
    return utilitaires.lire(config.AVENTURIERS / f"{t[code]['heros']['id']}.json")


def file_de(t, code) -> list:
    return demandes.lire(config.PROPOSITIONS, jid(t, code))


def confiee(t, code) -> dict:
    return next(d for d in reversed(file_de(t, code)) if d["genre"] == confie.GENRE)


def deposer(t, code, texte=TEXTE) -> dict:
    r = envoyer(t, code, texte)
    assert r.status_code == 200, r.text
    appliquer()
    return etat(t, code)


# ---------------------------------------------------------------- le genre, les secrets, les routes

def test_le_genre_et_sa_place():
    g = demandes.GENRES[confie.GENRE]
    assert g.attente is False and g.carnet is True and g.liste is True and g.annulable is False
    # Telegram le dit (le MJ veut le savoir), avec le prénom et le genre seulement.
    assert g.silencieux is False and "{n}" in g.telegram[1]
    # Un champ que le joueur n'écrit jamais dans sa proposition, et que l'invité du deuxième accès MJ ne lira pas.
    assert confie.CHAMP in joueurs.RESERVES
    assert confie.CHAMP in proprietes.SECRETS_DES_HEROS
    assert acces_mj.REGLES["POST /api/aventuriers/{ident}/confie/lu"] == acces_mj.PRINCIPAL_SEUL
    # Pas d'aide à l'écriture sur ce passage : le genre « aide » n'accepte que ceux du récit.
    assert confie.CHAMP not in lore.CHAMPS and "confie" not in lore.CHAMPS
    # Le reçu du MJ se dit au seul joueur concerné, comme ses demandes.
    assert flux_coin.sujet_du_fichier((confie.LUS, "capucine.json")) == ("capucine", "demandes")
    assert flux_coin.sujet_du_fichier((confie.DOSSIER, "capucine.json")) is None


def test_les_modules_de_la_page_sont_servis(tablee):
    c = coin(tablee, "c")
    for f in ("js/joueurs/histoire-confie.js", "css/confie-coin.css"):
        assert c.get(f"/static/{f}").status_code == 200, f
    html = c.get("/histoire").text
    assert 'id="confie-mj"' in html and "histoire-confie.js" in html
    # La section du MJ et la boîte ne sont pas servies au coin.
    for f in ("js/aventuriers/confie-mj.js", "js/demandes/confie.js", "css/confie-mj.css"):
        assert c.get(f"/static/{f}").status_code == 404, f


# ---------------------------------------------------------------- le brouillon

def test_le_brouillon_s_enregistre_et_reste_a_lui(neuf):
    e = etat(neuf, "c")
    assert e["ouvert"] and e["heros"] and e["brouillon"] is None and e["envoye"] is None and e["max"] == lore.LONG
    r = ecrire(neuf, "c", "Une peur des araignées.")
    assert r.status_code == 200, r.text
    assert r.json()["brouillon"] == "Une peur des araignées." and r.json()["enregistre"]
    assert etat(neuf, "c")["brouillon"] == "Une peur des araignées."
    # Dorian ne lit rien de Capucine ; le fichier est à elle, illisible des autres comptes du système.
    assert "araignées" not in json.dumps(etat(neuf, "d"), ensure_ascii=False)
    chemin = confie.fichier(config.PROPOSITIONS, jid(neuf, "c"))
    assert chemin.exists() and (chemin.stat().st_mode & 0o077) == 0
    # Vidé avant tout envoi, le brouillon s'efface.
    assert ecrire(neuf, "c", "   ").json()["brouillon"] is None
    assert not chemin.exists()


def test_les_bornes(neuf):
    assert ecrire(neuf, "c", "x" * lore.LONG).status_code == 200
    assert ecrire(neuf, "c", "x" * (lore.LONG + 1)).status_code == 413
    assert envoyer(neuf, "c", "x" * (lore.LONG + 1)).status_code == 413
    assert envoyer(neuf, "c", "  \n ").status_code == 400
    # Rien d'autre que le texte : ni un joueur, ni un héros, ni le champ de la fiche.
    for corps in ({"texte": "x", "joueur": jid(neuf, "d")}, {"texte": "x", "ref": "a" * 20}, {confie.CHAMP: "x"}):
        assert coin(neuf, "c").put("/api/confie", json=corps).status_code == 400
        assert coin(neuf, "c").post("/api/confie/envoyer", json=corps).status_code == 400
    assert coin(neuf, "c").put("/api/confie", json={"texte": 12}).status_code == 400


def test_rien_sans_session_ni_carnet_ni_heros(neuf):
    anonyme = TestClient(joueurs.app)
    assert anonyme.get("/api/confie").status_code == 401
    assert anonyme.put("/api/confie", json={"texte": "x"}).status_code == 401
    assert anonyme.post("/api/confie/envoyer", json={"texte": "x"}).status_code == 401
    ecrire(neuf, "c", "Avant la fermeture.")
    neuf["atelier"].put("/api/carnet-joueurs", json={"ouvert": False})
    try:
        assert etat(neuf, "c")["ouvert"] is False
        assert ecrire(neuf, "c", "Pendant.").status_code == 423
        assert envoyer(neuf, "c").status_code == 423
    finally:
        neuf["atelier"].put("/api/carnet-joueurs", json={"ouvert": True})
    assert etat(neuf, "c")["brouillon"] == "Avant la fermeture."
    demandes.ecrire_pause(config.PROPOSITIONS, True)
    try:
        assert ecrire(neuf, "c", "Pendant la pause.").status_code == 423
        assert envoyer(neuf, "c").status_code == 423
        assert etat(neuf, "c")["pause"] is True
    finally:
        demandes.ecrire_pause(config.PROPOSITIONS, False)


# ---------------------------------------------------------------- l'envoi, déposé sans validation

def test_envoyer_le_depose_sur_la_fiche(neuf):
    modifie_avant = fiche(neuf, "c")["modifie"]
    versions_avant = sorted((config.HISTORIQUE / "aventuriers" / neuf["c"]["heros"]["id"]).glob("*.json"))
    ecrire(neuf, "c", TEXTE)
    r = envoyer(neuf, "c")
    assert r.status_code == 200, r.text
    e = r.json()
    assert e["brouillon"] is None and e["envoye"]["texte"] == TEXTE and e["envoye"]["etat"] in ("en-route", "depose")
    d = confiee(neuf, "c")
    appliquer()
    f = fiche(neuf, "c")
    c = f[confie.CHAMP]
    assert c["texte"] == TEXTE and c["lu"] is None and c["envoi"] == d["id"] and c["joueur"] == jid(neuf, "c") and c["envoye"] == d["cree"]
    # Ni « modifie » ni l'historique : la fiche ouverte dans l'éditeur ne prend pas de conflit.
    assert f["modifie"] == modifie_avant
    assert sorted((config.HISTORIQUE / "aventuriers" / f["id"]).glob("*.json")) == versions_avant
    # La file n'en garde que la longueur ; le reçu, sans le texte.
    d = confiee(neuf, "c")
    assert d["statut"] == demandes.APPLIQUEE and d["corps"] == {"signes": len(TEXTE)}
    assert confie.lire_recu(config.PROPOSITIONS, jid(neuf, "c")) == {"envoi": d["id"], "lu": None}
    assert CANARI not in confie.fichier_recu(config.PROPOSITIONS, jid(neuf, "c")).read_text(encoding="utf-8")
    e = etat(neuf, "c")
    assert e["envoye"]["etat"] == "depose" and e["envoye"]["lu"] is None and e["envoye"]["texte"] == TEXTE
    # Le même texte ne repart pas ; « Mes demandes » le montre sans le texte.
    assert envoyer(neuf, "c").json().get("deja") is True
    assert len([x for x in file_de(neuf, "c") if x["genre"] == confie.GENRE]) == 1
    mes = coin(neuf, "c").get("/api/demandes").json()["demandes"]
    x = next(x for x in mes if x["genre"] == confie.GENRE)
    assert x["genre_nom"] == "Pour le MJ seulement" and x["statut_dit"] == "déposé sur la fiche"
    assert CANARI not in json.dumps(mes, ensure_ascii=False)


def test_par_la_file_commune_c_est_refuse(neuf):
    ref = carnet_api.ref_compagnon(neuf["c"]["heros"]["id"])
    r = coin(neuf, "c").post("/api/demandes", json={"genre": confie.GENRE, "corps": {"ref": ref, "passage": "x"}})
    assert r.status_code == 400 and "page" in r.json()["detail"]
    # Ni l'aide à l'écriture sur ce passage.
    for champ in ("confie", confie.CHAMP):
        r = coin(neuf, "c").post("/api/aide", json={"mode": "proposer", "champ": champ, "texte": "x"})
        assert r.status_code == 400


def test_le_mj_le_lit_puis_le_joueur_le_voit(neuf):
    deposer(neuf, "c")
    atelier = neuf["atelier"]
    hid = neuf["c"]["heros"]["id"]
    c = atelier.get(f"/api/aventuriers/{hid}").json()[confie.CHAMP]
    modifie_avant = fiche(neuf, "c")["modifie"]
    # Un autre texte que celui de la page : refusé, il reste nouveau.
    r = atelier.post(f"/api/aventuriers/{hid}/confie/lu", json={"envoi": "0" * 12})
    assert r.status_code == 409 and fiche(neuf, "c")[confie.CHAMP]["lu"] is None
    assert atelier.post(f"/api/aventuriers/{hid}/confie/lu", json={"envoi": "pas un id"}).status_code == 400
    r = atelier.post(f"/api/aventuriers/{hid}/confie/lu", json={"envoi": c["envoi"]})
    assert r.status_code == 200, r.text
    lu = r.json()[confie.CHAMP]["lu"]
    assert lu and fiche(neuf, "c")[confie.CHAMP]["lu"] == lu and fiche(neuf, "c")["modifie"] == modifie_avant
    assert confie.lire_recu(config.PROPOSITIONS, jid(neuf, "c")) == {"envoi": c["envoi"], "lu": lu}
    e = etat(neuf, "c")
    assert e["envoye"]["etat"] == "depose" and e["envoye"]["lu"] == lu
    # Dorian n'a ni texte ni reçu.
    assert etat(neuf, "d")["envoye"] is None
    # Rien de confié sur la fiche de Gaspard : rien à lire.
    assert atelier.post(f"/api/aventuriers/{neuf['d']['heros']['id']}/confie/lu", json={"envoi": c["envoi"]}).status_code == 404


def test_completer_ou_remplacer(neuf):
    deposer(neuf, "c", "Premier aveu.")
    hid = neuf["c"]["heros"]["id"]
    premier = fiche(neuf, "c")[confie.CHAMP]
    neuf["atelier"].post(f"/api/aventuriers/{hid}/confie/lu", json={"envoi": premier["envoi"]})
    # Le joueur repart de ce qu'il a confié : le brouillon ne vaut que s'il diffère.
    assert ecrire(neuf, "c", "Premier aveu.").json()["brouillon"] is None
    e = ecrire(neuf, "c", "Premier aveu. Et un second.").json()
    assert e["brouillon"] == "Premier aveu. Et un second." and e["envoye"]["texte"] == "Premier aveu."
    # « Revenir à ce que j'ai confié » efface le brouillon.
    e = coin(neuf, "c").put("/api/confie", json={"effacer": True}).json()
    assert e["brouillon"] is None and e["envoye"]["texte"] == "Premier aveu."
    ecrire(neuf, "c", "Premier aveu. Et un second.")
    deposer(neuf, "c", "Premier aveu. Et un second.")
    c = fiche(neuf, "c")[confie.CHAMP]
    # La nouvelle version remplace l'ancienne et revient « nouveau ».
    assert c["texte"] == "Premier aveu. Et un second." and c["lu"] is None and c["envoi"] != premier["envoi"]
    e = etat(neuf, "c")
    assert e["envoye"]["lu"] is None and e["brouillon"] is None
    # La boîte : la ligne du premier dit qu'il a été remplacé, celle du second qu'il attend d'être lu ; jamais le texte.
    v = neuf["atelier"].get("/api/demandes").json()
    lignes = [x for x in v["historique"] if x["genre"] == confie.GENRE and x["joueur"] == jid(neuf, "c")]
    assert len(lignes) == 2
    assert lignes[0]["phrase"] == "Capucine vous a confié un passage pour Ombeline : à lire sur sa fiche (page « Pour le MJ »), pas encore lu."
    assert lignes[1]["phrase"] == "Capucine vous a confié un passage pour Ombeline ; un texte plus récent l'a remplacé sur sa fiche."
    assert "aveu" not in json.dumps(v, ensure_ascii=False)


def test_le_champ_ne_s_ecrit_que_par_sa_route(neuf):
    deposer(neuf, "c")
    atelier = neuf["atelier"]
    hid = neuf["c"]["heros"]["id"]
    f = atelier.get(f"/api/aventuriers/{hid}").json()
    vrai = f[confie.CHAMP]
    # L'éditeur enregistre la fiche entière avec un champ périmé ou forgé : celui du disque reste.
    r = atelier.put(f"/api/aventuriers/{hid}", json={**f, confie.CHAMP: {"texte": "forgé", "envoi": "0" * 12}, "version_base": f["modifie"]})
    assert r.status_code == 200 and r.json()[confie.CHAMP] == vrai and fiche(neuf, "c")[confie.CHAMP] == vrai
    f = atelier.get(f"/api/aventuriers/{hid}").json()
    r = atelier.put(f"/api/aventuriers/{hid}", json={k: v for k, v in f.items() if k != confie.CHAMP} | {"version_base": f["modifie"]})
    assert r.status_code == 200 and fiche(neuf, "c")[confie.CHAMP] == vrai
    assert atelier.patch(f"/api/aventuriers/{hid}", json={confie.CHAMP: None}).status_code == 200
    assert fiche(neuf, "c")[confie.CHAMP] == vrai
    # Revenir à une version d'avant (gardée avec un autre texte) ne le remet pas en arrière.
    ancienne = config.HISTORIQUE / "aventuriers" / hid / "20200101-000000.json"
    ancienne.parent.mkdir(parents=True, exist_ok=True)
    utilitaires.ecrire(ancienne, {**fiche(neuf, "c"), "allure": "Une autre allure.", confie.CHAMP: {"texte": "ancien", "envoi": "2" * 12}})
    try:
        assert "20200101-000000" in [v["version"] for v in atelier.get(f"/api/versions/aventuriers/{hid}").json()["versions"]]
        r = atelier.post(f"/api/versions/aventuriers/{hid}/20200101-000000/remettre", json={})
        assert r.status_code == 200, r.text
        assert fiche(neuf, "c")["allure"] == "Une autre allure." and fiche(neuf, "c")[confie.CHAMP] == vrai
    finally:
        ancienne.unlink(missing_ok=True)
    # Une fiche créée dans l'atelier ne naît pas avec un texte confié.
    neuve = atelier.post("/api/aventuriers", json={"nom": "Copie", "tablee": False, confie.CHAMP: {"texte": "forgé", "envoi": "1" * 12}}).json()
    try:
        assert neuve.get(confie.CHAMP) is None
    finally:
        atelier.delete(f"/api/aventuriers/{neuve['id']}")


def test_un_autre_heros_n_est_pas_vise(neuf):
    """Le joueur a changé de héros entre l'envoi et le dépôt : rien n'est déposé, la page le dit, il peut renvoyer."""
    j = jid(neuf, "c")
    ref = carnet_api.ref_compagnon(neuf["c"]["heros"]["id"])
    d = demandes.nouvelle({"genre": confie.GENRE, "corps": {"ref": "f" * 20, "passage": TEXTE}})
    with demandes.verrou(config.PROPOSITIONS):
        demandes.ecrire(config.PROPOSITIONS, j, [d])
    with confie.verrou(config.PROPOSITIONS):
        f = confie.lire(config.PROPOSITIONS, j)
        confie.ecrire(config.PROPOSITIONS, j, confie.apres_envoi(f, ref, d))
    appliquer()
    d = confiee(neuf, "c")
    assert d["statut"] == demandes.ECHEC and d["corps"] == {"signes": len(TEXTE)} and confie.CHAMP not in fiche(neuf, "c")
    e = etat(neuf, "c")
    assert e["envoye"]["etat"] == "pas-depose" and e["envoye"]["resultat"] == confie.AUTRE_HEROS
    # Le même texte repart d'un geste, cette fois pour le bon héros.
    r = envoyer(neuf, "c")
    assert r.status_code == 200 and not r.json().get("deja")
    appliquer()
    assert fiche(neuf, "c")[confie.CHAMP]["texte"] == TEXTE
    # Un fichier écrit pour un autre héros que le sien ne compte plus : la page repart de rien.
    with confie.verrou(config.PROPOSITIONS):
        f = confie.lire(config.PROPOSITIONS, j)
        confie.ecrire(config.PROPOSITIONS, j, f | {"ref": "e" * 20})
    e = etat(neuf, "c")
    assert e["envoye"] is None and e["brouillon"] is None


def test_le_recu_et_le_brouillon_partent_avec_le_joueur(atelier, tablee):
    invite = atelier.post("/api/joueurs", json={"nom": "Éphémère"}).json()
    j = invite["id"]
    with confie.verrou(config.PROPOSITIONS):
        confie.ecrire(config.PROPOSITIONS, j, {"ref": "a" * 20, "brouillon": {"texte": "x", "modifie": "2026"}, "envoye": None, "modifie": "2026"})
    confie.ecrire_recu(config.PROPOSITIONS, j, "a" * 12, None)
    atelier.delete(f"/api/joueurs/{j}")
    assert not confie.fichier(config.PROPOSITIONS, j).exists()
    assert not confie.fichier_recu(config.PROPOSITIONS, j).exists()


def test_telegram_ne_dit_que_le_prenom_et_le_genre(neuf, tmp_path):
    envoyes = []

    class Faux:
        def configure(self):
            return True

        def envoyer(self, texte):
            envoyes.append(texte)
            return True

    async def signaler(_m):
        pass

    b = boite_mod.Boite(config.PROPOSITIONS, tmp_path, joueurs_lus=joueurs_mj.joueurs_lus, nettoyer_mot=lambda m: m, signaler=signaler, telegram=Faux())
    for genre in (confie.GENRE,):
        b.brancher(genre, **{k: getattr(commandes_api.boite.branchements[genre], k) for k in ("appliquer", "dire")})
    b.file = asyncio.Queue()

    async def vague():
        b.appliquer_tout()
        await b.annoncer()
        sortie = []
        while not b.file.empty():
            sortie.append(b.file.get_nowait())
        return sortie

    assert asyncio.run(vague()) == []
    assert envoyer(neuf, "c").status_code == 200
    vague1 = asyncio.run(vague())
    assert len(vague1) == 1 and "Capucine</b> : un passage pour toi seul." in vague1[0] and CANARI not in vague1[0]


# ---------------------------------------------------------------- les fuites

def gets_du_coin() -> list:
    return sorted(r.path for r in joueurs.app.routes if not isinstance(r, Mount) and "GET" in (getattr(r, "methods", None) or ())
                  and "{" not in r.path and r.path not in IGNOREES_COIN)


def tout_le_depot_sauf(permis: set) -> list:
    """Les fichiers des propositions qui contiennent le canari, hors de ceux permis."""
    trouves = []
    for f in config.PROPOSITIONS.rglob("*"):
        if f.is_file() and f not in permis:
            try:
                if CANARI.encode() in f.read_bytes():
                    trouves.append(str(f.relative_to(config.PROPOSITIONS)))
            except OSError:
                pass
    return trouves


def test_le_canari_ne_sort_que_chez_le_mj_et_chez_son_joueur(neuf, monkeypatch, caplog):
    caplog.set_level(logging.DEBUG)
    atelier = neuf["atelier"]
    client = FauxClient(*[PROPOSITION] * 8)
    monkeypatch.setattr(redaction, "CLIENT", client)
    commandes_api.aides_joueurs.publier_etat()
    # Capucine écrit, enregistre, envoie ; le MJ le reçoit et le lit ; puis elle écrit un brouillon de plus.
    ecrire(neuf, "c", TEXTE)
    assert envoyer(neuf, "c").status_code == 200
    appliquer()
    hid = neuf["c"]["heros"]["id"]
    assert atelier.get(f"/api/aventuriers/{hid}").json()[confie.CHAMP]["texte"] == TEXTE  # l'atelier du MJ le lit
    envoi = fiche(neuf, "c")[confie.CHAMP]["envoi"]
    assert atelier.post(f"/api/aventuriers/{hid}/confie/lu", json={"envoi": envoi}).status_code == 200
    ecrire(neuf, "c", f"{TEXTE} Et encore.")
    carnet_api.publier_carnet()
    carnet_api.publier_heros({hid, neuf["d"]["heros"]["id"]})

    # Le coin : chaque page, pour Dorian, et pour Capucine hors de sa page « Pour le MJ seulement ».
    pages = gets_du_coin()
    assert "/api/confie" in pages and {"/api/carnet", "/api/demandes", "/api/lore", "/api/aide", "/api/moi"} <= set(pages)
    for code in ("c", "d"):
        for url in pages:
            r = coin(neuf, code).get(url)
            if code == "c" and url == "/api/confie":
                assert CANARI in r.text
                continue
            assert CANARI not in r.text, (code, url)
    # Forger sa requête ne lit ni n'écrit celui d'un autre.
    for url in ("/api/confie?joueur=" + jid(neuf, "c"), "/api/confie?ref=x"):
        assert CANARI not in coin(neuf, "d").get(url).text
    r = coin(neuf, "d").put("/api/confie", json={"texte": "pirate", "joueur": jid(neuf, "c")})
    assert r.status_code == 400 and CANARI in confie.fichier(config.PROPOSITIONS, jid(neuf, "c")).read_text(encoding="utf-8")
    assert TestClient(joueurs.app).get("/api/confie").status_code == 401
    # Les routes du MJ n'existent pas au coin.
    assert coin(neuf, "d").post(f"/api/aventuriers/{hid}/confie/lu", json={"envoi": envoi}).status_code in (404, 405)

    # Les propositions : seulement le fichier de Capucine (son brouillon et ce qu'elle a envoyé) ; ni sa file de demandes,
    # ni son reçu, ni le carnet, ni la bible, ni la table du coin.
    assert tout_le_depot_sauf({confie.fichier(config.PROPOSITIONS, jid(neuf, "c"))}) == []

    # La TV et la table publique : ce que l'atelier leur publie des héros.
    jetons = [h["id"] for h in atelier.get("/api/table/heros").json()]
    for url in ("/api/table", "/api/table/heros", "/api/table/fiches", *[f"/api/table/aventurier/{j}" for j in jetons]):
        assert CANARI not in atelier.get(url).text, url
    assert CANARI not in json.dumps(tv_ecran.etat_table(), ensure_ascii=False)
    monkeypatch.setattr(portier, "TABLE_PUBLIQUE", {"table.example.ch"})
    monkeypatch.setattr(portier, "HOTES", portier.HOTES | {"table.example.ch"})
    for url in ("/api/table", "/api/table/heros", "/api/table/fiches", f"/api/aventuriers/{hid}"):
        assert CANARI not in atelier.get(url, headers={"Host": "table.example.ch"}).text, url
    for entetes in ({"CF-Connecting-IP": "203.0.113.9"}, {"Host": "table.example.ch"}):
        assert atelier.post(f"/api/aventuriers/{hid}/confie/lu", json={"envoi": envoi}, headers=entetes).status_code == 404
    monkeypatch.undo()
    monkeypatch.setattr(redaction, "CLIENT", client)

    # « Voir comme un joueur », pour l'un comme pour l'autre ; la boîte des demandes et la recherche du MJ.
    for code in ("c", "d"):
        assert CANARI not in atelier.get(f"/api/joueurs/{jid(neuf, code)}/apercu").text, code
    assert CANARI not in atelier.get("/api/demandes").text
    assert CANARI not in atelier.get("/api/recherche").text

    # Les contextes de rédaction du MJ et de l'aide des joueurs.
    for niveau in ("leger", "complet", "public"):
        assert CANARI not in json.dumps(contexte_du_modele.contexte_ia(niveau), ensure_ascii=False), niveau
    assert CANARI not in contexte_du_modele.etat_campagne_public(joueurs=True) and CANARI not in contexte_du_modele.etat_campagne()
    # L'aide à l'écriture, pour Capucine (sur un autre passage) comme pour Dorian : ce qui part vers le faux modèle.
    for code in ("c", "d"):
        r = coin(neuf, code).post("/api/aide", json={"mode": "proposer", "champ": "histoire", "texte": "Née sous la pluie."})
        assert r.status_code == 200, r.text
    assert asyncio.run(commandes_api.aides_joueurs.tout_traiter()) == 2
    assert len(client.appels) == 2 and CANARI not in json.dumps(client.appels, ensure_ascii=False)

    # Les journaux de l'atelier et du coin, tout du long.
    assert CANARI not in caplog.text
