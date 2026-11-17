"""La télécommande du MJ sur téléphone : la même garde que l'atelier, et le relais (telecommande.py) qui confie la musique
et les étapes du feu à un seul écran de l'atelier, une seule fois, borné en tout."""

import hashlib
import re
import json
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from api import application, config, pilotage, portier, tv_ecran, tv_etat  # noqa: E402
from table import musique  # noqa: E402
from table import telecommande  # noqa: E402
from sources_front import source_page  # noqa: E402

HOTE = "atelier.example.ch"
MDP = "lanterne-corbeau-moulin-givre-47"
PUBLIC = {"Host": HOTE, "CF-Connecting-IP": "203.0.113.9"}
A, B = "ecranaaaa0001", "ecranbbbb0002"


def empreinte(mdp: str) -> str:
    sel = b"0123456789abcdef"
    h = hashlib.scrypt(mdp.encode(), salt=sel, n=2 ** 10, r=8, p=1, dklen=32)
    return f"scrypt:{2 ** 10}:8:1:{sel.hex()}:{h.hex()}"


@pytest.fixture(scope="module")
def appli():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture
def client(appli, monkeypatch):
    monkeypatch.setattr(pilotage, "relais", telecommande.Relais())
    appli.cookies.clear()
    return appli


@pytest.fixture
def public(client, monkeypatch):
    monkeypatch.setattr(portier, "ATELIER_PUBLIC", {HOTE})
    monkeypatch.setattr(portier, "HOTES", portier.HOTES | {HOTE, "table.example.ch"})
    monkeypatch.setattr(portier, "TABLE_PUBLIQUE", {"table.example.ch"})
    monkeypatch.setattr(portier, "EMPREINTE_MDP", empreinte(MDP))
    monkeypatch.setattr(portier, "CLE_SESSION", b"cle-de-test")
    monkeypatch.setattr(portier, "ATTENTE_ECHEC", 0)
    portier.ECHECS_CONNEXION.clear()
    yield client
    portier.ECHECS_CONNEXION.clear()


@pytest.fixture
def ambiances(client, monkeypatch):
    async def faux_youtube(source):
        return {"lisible": True, "titre": "Titre", "auteur": "Studio"}

    monkeypatch.setattr(musique, "verifier", faux_youtube)
    actuel = client.get("/api/musique").json()
    d = client.put("/api/musique", json={"version_base": actuel["modifie"], "ambiances": [
        {"id": "a-auberge", "nom": "L'auberge", "lien": "https://www.youtube.com/playlist?list=PLexempleDeListe_0123456789abcdefg"},
        {"id": "a-route", "nom": "La route", "lien": "https://www.youtube.com/watch?v=Ambianc3abc"},
    ]})
    assert d.status_code == 200
    return [a["id"] for a in d.json()["ambiances"]]


@pytest.fixture
def plan_en_flammes(client):
    n = 4 * 3
    plan = {"nom": "Plan d'essai en flammes", "largeur": 4, "hauteur": 3, "feu": [0] * n, "brume": [0] * n, "etape": 0,
            "etapes": [{"nom": "Départ", "feu": [0] * n, "brume": [0] * n}, {"nom": "L'écurie", "feu": [2] * n, "brume": [1] * n}]}
    r = client.post("/api/plans", json=plan)
    assert r.status_code == 200
    return r.json()["id"]


def relever(client, ecran, **etat):
    r = client.post("/api/telecommande/releve", json={"ecran": ecran, **etat})
    assert r.status_code == 200, r.text
    return r.json()["commandes"]


def commander(client, **corps):
    return client.post("/api/telecommande/commandes", json=corps)


EN_MUSIQUE = {"musique": {"courante": "a-auberge", "nom": "L'auberge", "enPause": False, "joue": True, "liste": True}, "geste": True, "touche": 4}
SANS_MUSIQUE = {"musique": {"courante": None}, "geste": True, "touche": 1}


# La page et ses routes : protégées comme l'atelier.

def test_sur_le_reseau_local_la_page_repond(client):
    r = client.get("/telecommande", headers={"Host": "192.0.2.10:8323"})
    assert r.status_code == 200 and "Télécommande" in r.text and "/static/js/telecommande.js" in re.sub(r"/static/v-[0-9a-f]{10}/", "/static/", r.text)
    assert r.headers["cache-control"] == "no-cache"
    assert client.get("/static/js/telecommande.js").status_code == 200
    assert client.get("/static/css/telecommande.css").status_code == 200
    assert client.get("/api/telecommande").status_code == 200


def test_par_internet_sans_session_on_va_a_la_connexion(public):
    r = public.get("/telecommande", headers=PUBLIC, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/connexion?suite=%2Ftelecommande"
    assert public.get("/", headers=PUBLIC, follow_redirects=False).status_code == 303
    for chemin in ("/api/telecommande", "/api/telecommande/commandes/1", "/static/js/telecommande.js"):
        assert public.get(chemin, headers=PUBLIC, follow_redirects=False).status_code == 401
    entete = PUBLIC | {"Origin": f"https://{HOTE}"}
    assert public.post("/api/telecommande/commandes", json={"genre": "musique", "action": "pause"}, headers=entete).status_code == 401
    assert public.post("/api/telecommande/releve", json={"ecran": A}, headers=entete).status_code == 401


def test_par_internet_avec_session_la_page_s_ouvre(public):
    r = public.post("/connexion", data={"mot_de_passe": MDP, "suite": "/telecommande"},
                    headers=PUBLIC | {"Origin": f"https://{HOTE}"}, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/telecommande"
    h = PUBLIC | {"Cookie": r.headers["set-cookie"].split(";")[0]}
    assert public.get("/telecommande", headers=h).status_code == 200
    d = public.get("/api/telecommande", headers=h).json()
    assert d["ecrans"] == 0 and d["en_ligne"] == f"https://{HOTE}/telecommande"


@pytest.mark.parametrize("entetes", [{"Host": "table.example.ch", "CF-Connecting-IP": "203.0.113.9"}, {"CF-Connecting-IP": "203.0.113.9"}])
def test_la_table_publique_n_y_a_pas_acces(public, entetes):
    for chemin in ("/telecommande", "/api/telecommande", "/api/telecommande/commandes/1"):
        assert public.get(chemin, headers=entetes, follow_redirects=False).status_code == 404
    assert public.post("/api/telecommande/releve", json={"ecran": A}, headers=entetes).status_code == 404


# Le relais : des commandes vérifiées.

@pytest.mark.parametrize("corps, statut", [
    ({"genre": "tv"}, 400),
    ({}, 400),
    ({"genre": "musique", "action": "arreter"}, 400),
    ({"genre": "musique", "action": "choisir", "ambiance": "a-inconnue"}, 404),
    ({"genre": "musique", "action": "choisir", "ambiance": ["a-auberge"]}, 404),
    ({"genre": "etape", "plan": "../secret", "etape": 0}, 400),
    ({"genre": "etape", "plan": "plan-qui-n-existe-pas", "etape": 0}, 404),
    ({"genre": "etape", "plan": None, "etape": 0}, 400),
])
def test_une_commande_illisible_est_refusee(client, ambiances, corps, statut):
    relever(client, A, **EN_MUSIQUE)
    assert commander(client, **corps).status_code == statut
    assert pilotage.relais.commandes == []


@pytest.mark.parametrize("etape", [2, -1, True, "1", 1.5, None])
def test_une_etape_hors_du_plan_est_refusee(client, plan_en_flammes, etape):
    relever(client, A, plan=plan_en_flammes)
    r = commander(client, genre="etape", plan=plan_en_flammes, etape=etape)
    assert r.status_code == 400 and pilotage.relais.commandes == []


def test_sans_atelier_ouvert_la_musique_est_refusee_tout_de_suite(client, ambiances):
    r = commander(client, genre="musique", action="choisir", ambiance="a-route")
    assert r.status_code == 409 and "ouvrez l'atelier sur l'ordinateur" in r.json()["detail"]
    relever(client, A, **SANS_MUSIQUE)
    r = commander(client, genre="musique", action="pause")
    assert r.status_code == 409 and "Aucune musique ne joue" in r.json()["detail"]


def test_un_ecran_inconnu_ne_releve_rien(client):
    for ecran in (None, "", "COURT", "a" * 40, "ecran/../x", 12345678):
        r = client.post("/api/telecommande/releve", json={"ecran": ecran})
        assert r.status_code == 400


# Le relais : une seule fois, un seul écran.

def test_la_commande_va_au_seul_lecteur_et_une_seule_fois(client, ambiances):
    relever(client, A, **EN_MUSIQUE)
    relever(client, B, **SANS_MUSIQUE)
    c = commander(client, genre="musique", action="pause").json()
    assert c["relais"] is True and c["etat"] == "attente"
    assert relever(client, B, **SANS_MUSIQUE) == []
    donnees = relever(client, A, **EN_MUSIQUE)
    assert donnees == [{"numero": c["numero"], "genre": "musique", "action": "pause"}]
    assert client.get(f"/api/telecommande/commandes/{c['numero']}").json()["etat"] == "prise"
    # Sans résultat rendu (réponse perdue), le même écran la revoit, à son numéro ; jamais l'autre.
    assert relever(client, A, **EN_MUSIQUE) == donnees
    assert relever(client, B, **SANS_MUSIQUE) == []
    r = client.post(f"/api/telecommande/commandes/{c['numero']}/resultat", json={"ecran": B, "ok": True})
    assert r.json() == {"pris": False}
    r = client.post(f"/api/telecommande/commandes/{c['numero']}/resultat",
                    json={"ecran": A, "ok": True, "message": "La musique est en pause sur l'ordinateur."})
    assert r.json() == {"pris": True}
    assert client.post(f"/api/telecommande/commandes/{c['numero']}/resultat", json={"ecran": A, "ok": False}).json() == {"pris": False}
    suivi = client.get(f"/api/telecommande/commandes/{c['numero']}").json()
    assert suivi == {"numero": c["numero"], "genre": "musique", "etat": "faite", "message": "La musique est en pause sur l'ordinateur.", "libre": False}
    assert relever(client, A, **EN_MUSIQUE) == []


def test_un_renvoi_du_telephone_ne_double_pas_la_commande(client, ambiances):
    relever(client, A, **EN_MUSIQUE)
    premier = commander(client, genre="musique", action="morceau", jeton="abcdef0123456789").json()
    second = commander(client, genre="musique", action="morceau", jeton="abcdef0123456789").json()
    assert premier["numero"] == second["numero"] and len(pilotage.relais.commandes) == 1
    autre = commander(client, genre="musique", action="morceau", jeton="0123456789abcdef").json()
    assert autre["numero"] != premier["numero"]


def test_les_numeros_ne_reviennent_pas_apres_un_redemarrage(client, ambiances, monkeypatch):
    relever(client, A, **EN_MUSIQUE)
    for _ in range(5):
        avant = commander(client, genre="musique", action="pause").json()["numero"]
    heure = telecommande.time.time()
    monkeypatch.setattr(telecommande.time, "time", lambda: heure + 2)  # le serveur redémarre deux secondes plus tard
    neuf = telecommande.Relais()
    neuf.releve(A, EN_MUSIQUE, 0)
    assert neuf.ajouter({"genre": "musique", "action": "pause"}, 0)["numero"] > avant


def test_le_lecteur_est_l_ecran_qui_joue_sinon_le_dernier_qui_a_joue_sinon_le_dernier_touche():
    r = telecommande.Relais()
    r.releve(A, {"musique": {"courante": None}, "geste": True, "touche": 300}, 0)
    r.releve(B, {"musique": {"courante": None}, "geste": True, "touche": 2}, 0)
    assert r.lecteur(1)["id"] == B  # le dernier touché
    r.releve(A, {"musique": {"courante": "a-route"}, "geste": True, "touche": 300}, 2)
    assert r.lecteur(3)["id"] == A  # celui qui joue, même touché plus tôt
    r.releve(A, {"musique": {"courante": None}, "geste": True, "touche": 300}, 4)
    assert r.lecteur(5)["id"] == A  # le dernier qui a joué, encore ouvert
    r.adieu(A)
    assert r.lecteur(6)["id"] == B
    # Un écran jamais touché ne passe qu'en dernier recours : son navigateur bloquerait le son.
    s = telecommande.Relais()
    s.releve(A, {"musique": {"courante": None}, "geste": False, "touche": None}, 0)
    s.releve(B, {"musique": {"courante": None}, "geste": True, "touche": 900}, 0)
    assert s.lecteur(1)["id"] == B


def test_un_ecran_endormi_ne_recoit_plus_rien_et_la_commande_se_perime():
    r = telecommande.Relais()
    r.releve(A, EN_MUSIQUE, 0)
    c = r.ajouter({"genre": "musique", "action": "pause"}, 1)
    assert r.etat(telecommande.VIVANT + 0.5)["ecrans"] == 0
    with pytest.raises(telecommande.Refus):
        r.ajouter({"genre": "musique", "action": "pause"}, telecommande.VIVANT + 1)
    assert r.lire(c["numero"], telecommande.ATTENTE + 2)["etat"] == "perimee"
    assert r.releve(A, EN_MUSIQUE, telecommande.ATTENTE + 3) == []


def test_un_ecran_qui_se_ferme_rend_ce_qu_il_tenait():
    r = telecommande.Relais()
    r.releve(A, EN_MUSIQUE, 0)
    c = r.ajouter({"genre": "musique", "action": "morceau"}, 0)
    assert r.releve(A, EN_MUSIQUE, 1)
    r.adieu(A)
    assert r.lire(c["numero"], 2) | {"message": ""} == {"numero": c["numero"], "genre": "musique", "etat": "echec", "message": "", "libre": False}
    assert r.etat(2)["ecrans"] == 0


def test_adieu_par_la_route(client, ambiances):
    relever(client, A, **EN_MUSIQUE)
    assert client.post("/api/telecommande/adieu", json={"ecran": A}).json() == {"ok": True}
    assert client.get("/api/telecommande").json()["ecrans"] == 0


# Les étapes du feu : à l'éditeur qui tient le plan, sinon au téléphone.

def test_l_etape_va_a_l_editeur_qui_tient_le_plan(client, plan_en_flammes):
    relever(client, A, plan=None, **SANS_MUSIQUE)
    assert commander(client, genre="etape", plan=plan_en_flammes, etape=1).json() == {"relais": False}
    assert pilotage.relais.commandes == []
    relever(client, B, plan=plan_en_flammes, **SANS_MUSIQUE)
    c = commander(client, genre="etape", plan=plan_en_flammes, etape=1).json()
    assert c["relais"] is True
    assert relever(client, A, plan=None, **SANS_MUSIQUE) == []
    assert relever(client, B, plan=plan_en_flammes, **SANS_MUSIQUE) == [{"numero": c["numero"], "genre": "etape", "plan": plan_en_flammes, "etape": 1}]
    # L'éditeur ne l'a pas prise (plan fermé entre-temps) : libre, le téléphone la rappelle lui-même.
    client.post(f"/api/telecommande/commandes/{c['numero']}/resultat", json={"ecran": B, "ok": False, "libre": True, "message": "plan fermé"})
    assert client.get(f"/api/telecommande/commandes/{c['numero']}").json()["libre"] is True
    assert client.get("/api/telecommande").json()["plans"] == [plan_en_flammes]


def test_le_telephone_ne_reprend_qu_une_commande_que_personne_n_a_prise(client, plan_en_flammes):
    relever(client, B, plan=plan_en_flammes)
    c = commander(client, genre="etape", plan=plan_en_flammes, etape=0).json()
    r = client.delete(f"/api/telecommande/commandes/{c['numero']}").json()
    assert r["annulee"] is True and r["etat"] == "annulee"
    assert relever(client, B, plan=plan_en_flammes) == []
    d = commander(client, genre="etape", plan=plan_en_flammes, etape=1).json()
    relever(client, B, plan=plan_en_flammes)
    r = client.delete(f"/api/telecommande/commandes/{d['numero']}").json()
    assert r["annulee"] is False and r["etat"] == "prise"
    assert client.delete("/api/telecommande/commandes/123").status_code == 404
    assert client.get("/api/telecommande/commandes/123").status_code == 404


# Le relais : borné en tout.

def test_ce_qu_un_ecran_dit_de_lui_est_borne(client):
    relever(client, A, musique={"courante": "a-route", "nom": "N" * 500, "titre": "T" * 900, "enPause": "oui", "joue": 1, "liste": True},
           plan="Plan Invalide!", touche=10 ** 12, geste="vrai", inconnu="x" * 1000)
    e = pilotage.relais.ecrans[A]
    assert len(e["musique"]["nom"]) == 60 and len(e["musique"]["titre"]) == 200
    assert e["musique"]["enPause"] is False and e["musique"]["joue"] is False and e["musique"]["liste"] is True
    assert e["plan"] is None and e["touche"] == telecommande.TOUCHE_MAX and e["geste"] is False and "inconnu" not in e
    relever(client, A, musique={"courante": "<script>"}, touche="3")
    assert pilotage.relais.ecrans[A]["musique"]["courante"] is None and pilotage.relais.ecrans[A]["touche"] is None
    # Le JSON de Python lit NaN : il ne passe pas.
    r = client.post("/api/telecommande/releve", content='{"ecran": "ecranaaaa0001", "touche": NaN}', headers={"Content-Type": "application/json"})
    assert r.status_code == 200 and pilotage.relais.ecrans[A]["touche"] is None


def test_le_message_rendu_est_borne(client, ambiances):
    relever(client, A, **EN_MUSIQUE)
    c = commander(client, genre="musique", action="pause").json()
    relever(client, A, **EN_MUSIQUE)
    client.post(f"/api/telecommande/commandes/{c['numero']}/resultat", json={"ecran": A, "ok": False, "message": "x" * 5000})
    assert len(client.get(f"/api/telecommande/commandes/{c['numero']}").json()["message"]) == telecommande.MESSAGE_MAX


def test_le_nombre_de_commandes_en_attente_et_gardees_est_borne(client, ambiances):
    relever(client, A, **EN_MUSIQUE)
    for _ in range(telecommande.EN_ATTENTE_MAX):
        assert commander(client, genre="musique", action="pause").status_code == 200
    r = commander(client, genre="musique", action="pause")
    assert r.status_code == 409 and "patientez" in r.json()["detail"]
    r = telecommande.Relais()
    r.releve(A, EN_MUSIQUE, 0)
    for k in range(telecommande.COMMANDES_MAX + 25):
        c = r.ajouter({"genre": "musique", "action": "pause"}, k)
        r.releve(A, EN_MUSIQUE, k)
        r.resultat(A, c["numero"], True, "", k)
    assert len(r.commandes) == telecommande.COMMANDES_MAX


def test_le_nombre_d_ecrans_est_borne():
    r = telecommande.Relais()
    for k in range(telecommande.ECRANS_MAX + 10):
        r.releve(f"ecran{k:08d}", {}, k)
    assert len(r.ecrans) == telecommande.ECRANS_MAX
    assert "ecran00000000" not in r.ecrans and f"ecran{telecommande.ECRANS_MAX + 9:08d}" in r.ecrans
    r.releve("ecranneuf0001", {}, telecommande.OUBLI + 100)
    assert list(r.ecrans) == ["ecranneuf0001"]


def test_le_relais_ne_touche_ni_a_la_table_ni_au_disque(client, ambiances):
    avant = client.get("/api/table").json()
    fichiers = sorted(p.name for p in config.DONNEES.rglob("*") if p.is_file())
    relever(client, A, **EN_MUSIQUE)
    c = commander(client, genre="musique", action="choisir", ambiance="a-route").json()
    relever(client, A, **EN_MUSIQUE)
    client.post(f"/api/telecommande/commandes/{c['numero']}/resultat", json={"ecran": A, "ok": True})
    apres = client.get("/api/table").json()
    assert {k: v for k, v in apres.items() if k != "maj"} == {k: v for k, v in avant.items() if k != "maj"}
    assert sorted(p.name for p in config.DONNEES.rglob("*") if p.is_file()) == fichiers
    assert "a-route" not in json.dumps(tv_etat.etat_public(tv_ecran.etat_table()))


def test_la_telecommande_regle_les_horloges():
    """Les horloges préparées dans le Tableau se règlent aussi du téléphone, par les routes des horloges : le compte visé
    est envoyé (un nouvel essai après une réponse perdue ne compte pas double), et la bascule à la TV."""
    js = source_page("telecommande")
    assert 'api.get("/api/horloges")' in js
    assert "{ remplies: vise }" in js and "{ visible: montrer }" in js
    assert "{ pas" not in js
    assert 'g === "horloge"' in js and 'g === "horloge-tv"' in js
