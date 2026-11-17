"""La table dans le coin des joueurs (table_joueurs.py) : fermée par défaut ; ouverte, l'atelier publie dans
propositions/table/ ce que montre la TV, sans sa caméra, et pour chaque joueur l'id public de son seul pion. Rien de ce
que la TV ne montre pas n'y entre (pièce cachée, porte secrète, piège, pion caché ou perdu dans la brume épaisse, notes du
MJ, nom caché de l'auberge), ni la référence d'un pion ; le coin ne sert ces fichiers qu'à un joueur connecté, une image
que par un nom vérifié."""
import json
import os
import sys
import tempfile
import time
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from commun import carnet  # noqa: E402
from commun import flux_coin  # noqa: E402
import joueurs  # noqa: E402
import main  # noqa: E402
from api import application, config, tv_etat  # noqa: E402
from commun import table_joueurs  # noqa: E402
from comptes_coin import entrer as entrer_au_coin  # noqa: E402

TABLE = config.PROPOSITIONS / table_joueurs.DOSSIER
W, H = 8, 4
# Ce qui ne doit jamais atteindre le coin : rien de ce qui est caché, rien du MJ, ni le nom caché de l'auberge.
SECRETS = ("SALLE-CACHEE", "NOTE-", "PIEGE-", "EMBUSCADE", "DANS-LA-BRUME", "GOBELIN-DU-NOIR", "TEXTE-MJ", "LIEU-SECRET",
           "Plan d'essai de la table", "plan-d-essai-de-la-table", "Fanfrel", "fanfrel", "ne dort", "ADVERSAIRE-",
           "CAPACITE-", "fond-table-essai", "portrait-aude", "aventurier:", "\"ref\"", "piege", "secrete", "verrouillee",
           "camera", "\"/media/", "/api/table/")


def image(nom, taille=(80, 40), couleur=(240, 240, 240)):
    Image.new("RGB", taille, couleur).save(config.IMAGES / nom)
    return f"/media/{nom}"


def grille(cases: dict, defaut=0) -> list:
    return [cases.get((x, y), defaut) for y in range(H) for x in range(W)]


def plan_d_essai(aude: str, bertrand: str) -> dict:
    """Deux salles : A (x < 4) révélée, B (x >= 4) cachée ; une porte secrète entre elles, un piège caché dans A, un pion
    en embuscade, un autre dans la brume épaisse, un dans le noir de B ; les pions des deux héros dans A."""
    return {
        "nom": "Plan d'essai de la table", "lieu": "LIEU-SECRET", "largeur": W, "hauteur": H, "m_case": 1.5,
        "brouillard_actif": True, "notes": "NOTE-PLAN", "style": "couleur",
        "sol": [2] * (W * H), "piece": grille({(x, y): 1 if x < 4 else 2 for y in range(H) for x in range(W)}),
        "brouillard": grille({(x, y): 1 if x < 4 else 0 for y in range(H) for x in range(W)}),
        "brume": grille({(3, 3): 2, (6, 1): 2}),
        "pieces": [{"id": 1, "nom": "La salle de la Petite Fanfrelée", "genre": "salle", "notes": "NOTE-SALLE-A", "nom_visible": True},
                   {"id": 2, "nom": "SALLE-CACHEE", "genre": "salle", "notes": "NOTE-SALLE-B", "nom_visible": True}],
        "portes": [{"id": "porte-1", "sens": "v", "x": 4, "y": 1, "genre": "secrete", "etat": "fermee", "decouverte": False, "note": "NOTE-PORTE"},
                   {"id": "porte-2", "sens": "v", "x": 4, "y": 3, "genre": "porte", "etat": "verrouillee", "note": "NOTE-SERRURE"}],
        "objets": [{"id": "o-table", "cle": "table", "x": 0, "y": 0, "l": 2, "h": 1, "rot": 0, "note": "NOTE-TABLE"},
                   {"id": "o-piege", "cle": "piege", "x": 2, "y": 2, "l": 1, "h": 1, "cache": True, "note": "PIEGE-A-FOSSE"},
                   {"id": "o-coffre", "cle": "coffre", "x": 5, "y": 2, "l": 1, "h": 1, "note": "NOTE-COFFRE"}],
        "pions": [{"id": "t-aude", "genre": "heros", "nom": "Aude", "ref": f"aventurier:{aude}", "x": 0.5, "y": 1.5},
                  {"id": "t-bertrand", "genre": "heros", "nom": "Bertrand", "ref": f"aventurier:{bertrand}", "x": 1.5, "y": 2.5, "cache": True},
                  {"id": "t-embuscade", "genre": "ennemi", "nom": "EMBUSCADE", "court": "1", "x": 2.5, "y": 0.5, "cache": True},
                  {"id": "t-brume", "genre": "ennemi", "nom": "DANS-LA-BRUME", "court": "2", "x": 3.5, "y": 3.5},
                  {"id": "t-noir", "genre": "ennemi", "nom": "GOBELIN-DU-NOIR", "court": "3", "x": 6.5, "y": 0.5},
                  {"id": "t-garde", "genre": "ennemi", "nom": "Garde", "court": "4", "x": 3.5, "y": 0.5}],
        "textes": [{"id": "x-mj", "texte": "TEXTE-MJ", "x": 1, "y": 1, "mj": True},
                   {"id": "x-elle", "texte": "Ici dormait Jamais ne dort", "x": 1, "y": 3}],
        "fond": {"url": image("fond-table-essai.png"), "x": 0, "y": 0, "l": W, "h": H, "opacite": 1},
    }


@pytest.fixture(scope="module")
def atelier():
    with TestClient(application.app) as c:
        yield c


def nouveau_coin(monkeypatch):
    monkeypatch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    monkeypatch.setattr(joueurs, "COOKIE_SUR", False)
    monkeypatch.setattr(joueurs, "HOTES", set())
    return TestClient(joueurs.app)


@pytest.fixture()
def monde(atelier, monkeypatch):
    """Deux joueurs reliés à leur héros (Aude, Bertrand), un plan à secrets, une séance avec un combat. Tout repart à la fin,
    et la table se referme."""
    crees, invites = [], []

    def creer(collection, **fiche):
        f = atelier.post(f"/api/{collection}", json=fiche).json()
        crees.append((collection, f["id"]))
        return f

    # Une autre Léa, sans héros, invitée avant les deux joueurs : un même prénom (ou un joueur qu'un module d'avant aurait
    # laissé en cassant) ne doit tromper ni l'atelier ni ces essais.
    homonyme = atelier.post("/api/joueurs", json={"nom": "Léa"}).json()
    invites.append(homonyme["id"])
    m_homonyme = nouveau_coin(monkeypatch)
    entrer_au_coin(m_homonyme, homonyme)
    portrait = image("portrait-aude.png", (60, 90), (120, 30, 30))
    aude = creer("aventuriers", nom="Aude de Valcombe", genre="f", tablee=True, couleur="#2e7d32",
                 illustrations=[{"url": portrait}], illustration=portrait, secret="NOTE-SECRET-AUDE", notes_mj="NOTE-MJ-AUDE")
    bertrand = creer("aventuriers", nom="Bertrand Lavelle", genre="h", tablee=True, couleur="#1565c0")
    m = {"aude": aude, "bertrand": bertrand, "homonyme": m_homonyme}
    for cle, nom, heros in (("lea", "Léa", aude), ("basile", "Basile", bertrand)):
        invite = atelier.post("/api/joueurs", json={"nom": nom}).json()
        invites.append(invite["id"])
        assert atelier.post(f"/api/joueurs/{invite['id']}/relier", json={"heros": heros["id"]}).status_code == 200
        coin = nouveau_coin(monkeypatch)
        entrer_au_coin(coin, invite)
        m[cle], m[f"{cle}_id"] = coin, invite["id"]
    m["plan"] = creer("plans", **plan_d_essai(aude["id"], bertrand["id"]))
    m["autre"] = creer("plans", nom="Autre plan d'essai", largeur=3, hauteur=2, brouillard_actif=False, sol=[2] * 6, piece=[1] * 6,
                       pieces=[{"id": 1, "nom": "Cour", "genre": "salle"}], portes=[], objets=[], textes=[], pions=[],
                       fond={"url": image("fond-autre-essai.png", (30, 20), (90, 90, 90)), "x": 0, "y": 0, "l": 3, "h": 2})
    m["seance"] = creer("seances", nom="Séance de la table", numero=3, date="2026-11-08")
    yield m
    atelier.put("/api/table-joueurs", json={"ouverte": False})
    atelier.delete(f"/api/seances/{m['seance']['id']}/combat")
    atelier.put("/api/table", json={"vue": "accueil"})
    for ident in invites:
        atelier.delete(f"/api/joueurs/{ident}")
    for collection, ident in crees:
        atelier.delete(f"/api/{collection}/{ident}")
    tv_etat.TABLE_JOUEURS.unlink(missing_ok=True)
    table_joueurs.fermer(config.PROPOSITIONS)


def cle_de(ident: str) -> str:
    """La clé du lien d'un joueur, celle sous laquelle l'atelier publie son pion (comme sa fiche du carnet). Par son
    identifiant, jamais par son prénom : les données de la suite sont partagées, et un module d'avant qui casse en route
    y laisse ses joueurs (une « Léa » sans héros faisait échouer ce fichier)."""
    return carnet.cle_heros(next(j["jeton"] for j in joueurs.acces() if j["id"] == ident))


def montrer_plan(atelier, plan, **en_plus):
    etat = {"vue": "plan", "plan": plan["id"], "style": "couleur", "camera": {"x": 1.25, "y": 2.5, "hv": 6}, **en_plus}
    assert atelier.put("/api/table", json=etat).status_code == 200
    return tv_etat.table_coin.tout_de_suite()


def tout_ce_qui_est_publie() -> str:
    """Le texte de chaque fichier de table/ (les images, par leur nom seulement)."""
    morceaux = []
    for f in sorted(TABLE.rglob("*")):
        if f.is_file():
            morceaux.append(f.name if f.suffix == ".jpg" else f.read_text(encoding="utf-8"))
    return "\n".join(morceaux)


def test_fermee_par_defaut(atelier, monde):
    r = atelier.get("/api/table-joueurs").json()
    assert {k: r[k] for k in table_joueurs.REGLAGE_DEFAUT} == table_joueurs.REGLAGE_DEFAUT
    assert r["ouverte"] is False and r["pions"] == "a-valider"
    # La TV montre un plan : rien ne part tant que le MJ n'a pas ouvert la table.
    assert montrer_plan(atelier, monde["plan"]) == {"ouverte": False, "genre": None, "pions": 0}
    assert not TABLE.exists()
    assert monde["lea"].get("/api/table").json() == {"ouverte": False}
    # Un réglage abîmé laisse la table fermée.
    tv_etat.TABLE_JOUEURS.write_text('{"ouverte": "oui", "pions": "partout", "distance": 9999}', encoding="utf-8")
    assert tv_etat.reglage_table_joueurs() == table_joueurs.REGLAGE_DEFAUT | {"modifie": None}
    tv_etat.TABLE_JOUEURS.unlink()


def test_le_reglage_du_mj(atelier, monde):
    for corps in ({"ouverte": "oui"}, {"pions": "partout"}, {"distance": 0}, {"distance": 61}, {"distance_combat": 2.5},
                  {"entrer": 1}, {"inconnu": True}, {}):
        assert atelier.put("/api/table-joueurs", json=corps).status_code == 400, corps
    r = atelier.put("/api/table-joueurs", json={"pions": "libres", "distance": 8, "distance_combat": 5, "entrer": False}).json()
    assert (r["ouverte"], r["pions"], r["distance"], r["distance_combat"], r["entrer"]) == (False, "libres", 8, 5, False)
    assert r["modifie"] and not TABLE.exists()
    # Depuis Internet (la table publique), ni lecture ni écriture du réglage.
    for methode in ("GET", "PUT"):
        assert atelier.request(methode, "/api/table-joueurs", json={"ouverte": True}, headers={"CF-Connecting-IP": "203.0.113.9"}).status_code == 404
    assert tv_etat.reglage_table_joueurs()["ouverte"] is False


def test_rien_de_cache_ne_sort(atelier, monde):
    montrer_plan(atelier, monde["plan"])
    r = atelier.put("/api/table-joueurs", json={"ouverte": True}).json()
    assert r["ouverte"] is True and r["publie"] == {"ouverte": True, "genre": "plan", "pions": 1}
    publie = tout_ce_qui_est_publie()
    lea, basile = monde["lea"].get("/api/table"), monde["basile"].get("/api/table")
    for texte in (publie, lea.text, basile.text):
        for interdit in SECRETS:
            assert interdit not in texte, interdit
    v = lea.json()["vue"]
    p = v["plan"]
    assert v["genre"] == "plan" and v["style"] == "couleur" and v["combat"] is None
    # Exactement ce que reçoit la TV : la salle A, son seul meuble visible, la porte verrouillée vue comme une porte fermée
    # (la secrète est encore cachée), les pions montrés, le texte public au nom masqué.
    assert [x["nom"] for x in p["pieces"]] == ["La salle de l'auberge"]
    assert p["sol"] == grille({(x, y): 2 for y in range(H) for x in range(4)})
    assert [(d["id"], d["genre"], d["etat"]) for d in p["portes"]] == [("porte-2", "porte", "fermee")]
    assert [o["id"] for o in p["objets"]] == ["o-table"]
    assert [t["id"] for t in p["pions"]] == ["t-aude", "t-garde"]
    assert [t["texte"] for t in p["textes"]] == ["Ici dormait l'auberge"]
    assert all(set(t) <= {"id", "genre", "court", "x", "y", "taille", "tombe", "couleur", "nom", "image", "jauges"} for t in p["pions"])
    # La brume épaisse : sur les cases révélées seulement, et l'ennemi qui s'y cache n'est pas montré.
    assert p["brume"] == grille({(3, 3): 2})
    # Le fond noirci et le portrait réduit passent par les médias de la table, sous un nom tiré de leur contenu.
    assert p["fond"]["url"].startswith("/table/media/") and p["pions"][0]["image"].startswith("/table/media/")
    medias = sorted(f.name for f in (TABLE / table_joueurs.MEDIA).iterdir())
    assert len(medias) == 2 and all(table_joueurs.NOM_MEDIA.match(n) for n in medias)
    fond = monde["lea"].get(p["fond"]["url"])
    assert fond.status_code == 200 and fond.headers["content-type"] == "image/jpeg"
    gris = Image.open(__import__("io").BytesIO(fond.content)).convert("L")
    assert gris.getpixel((5, 20)) > 200 and gris.getpixel((75, 20)) < 30
    # La porte secrète découverte paraît, comme une porte ordinaire ; la salle B révélée aussi.
    plan = atelier.get(f"/api/plans/{monde['plan']['id']}").json()
    plan["portes"][0]["decouverte"] = True
    plan["brouillard"] = [1] * (W * H)
    atelier.put(f"/api/plans/{plan['id']}", json=plan)
    tv_etat.table_coin.tout_de_suite()
    p = monde["lea"].get("/api/table").json()["vue"]["plan"]
    assert {d["id"]: (d["genre"], d["etat"]) for d in p["portes"]} == {"porte-1": ("porte", "fermee"), "porte-2": ("porte", "fermee")}
    assert "t-noir" in [t["id"] for t in p["pions"]] and "SALLE-CACHEE" in [x["nom"] for x in p["pieces"]]
    texte = tout_ce_qui_est_publie()
    for interdit in ("NOTE-", "PIEGE-", "EMBUSCADE", "DANS-LA-BRUME", "TEXTE-MJ", "aventurier:", "Fanfrel", "secrete", "verrouillee"):
        assert interdit not in texte, interdit


def test_chaque_joueur_ne_voit_que_son_pion(atelier, monde):
    lea_id, basile_id = monde["lea_id"], monde["basile_id"]
    montrer_plan(atelier, monde["plan"])
    atelier.put("/api/table-joueurs", json={"ouverte": True})
    lea, basile = monde["lea"].get("/api/table").json(), monde["basile"].get("/api/table").json()
    # L'autre Léa, sans héros, invitée la première : le même prénom ne mêle pas les pions.
    assert monde["homonyme"].get("/api/table").json()["pion"] is None
    # Le pion, et pour le bouger son tour au combat et la case où ce tour a commencé.
    assert set(lea) == {"ouverte", "vue", "pion", "mon_tour", "combat", "debut"}
    assert (lea["pion"], basile["pion"]) == ("t-aude", None)  # le pion de Bertrand est caché
    # Un fichier par joueur, sous la clé de son lien : ni son identifiant, ni la référence du pion, ni rien d'autre.
    fichiers = sorted((TABLE / table_joueurs.PIONS).glob("*.json"))
    assert {cle_de(lea_id), cle_de(basile_id)} <= {f.stem for f in fichiers}
    for f in fichiers:
        assert table_joueurs.CLE.match(f.stem) and set(json.loads(f.read_text(encoding="utf-8"))) == {"maj", "pion", "mon_tour", "combat", "debut"}
    assert json.loads((TABLE / table_joueurs.PIONS / f"{cle_de(lea_id)}.json").read_text(encoding="utf-8"))["pion"] == "t-aude"
    # Bertrand sort de l'ombre : chacun voit le sien, jamais celui de l'autre.
    plan = atelier.get(f"/api/plans/{monde['plan']['id']}").json()
    plan["pions"][1]["cache"] = False
    atelier.put(f"/api/plans/{plan['id']}", json=plan)
    tv_etat.table_coin.tout_de_suite()
    assert monde["lea"].get("/api/table").json()["pion"] == "t-aude"
    assert monde["basile"].get("/api/table").json()["pion"] == "t-bertrand"
    # Un pion publié qui n'est plus montré sur le plan ne sert plus : la page n'en voit rien.
    vue = table_joueurs.vue_publiee(config.PROPOSITIONS)
    vue["plan"]["pions"] = [t for t in vue["plan"]["pions"] if t["id"] != "t-aude"]
    assert table_joueurs.pion_publie(config.PROPOSITIONS, cle_de(lea_id), vue) == {"pion": None, "mon_tour": False, "combat": False, "debut": None}
    # Une clé qui n'en est pas une ne mène à aucun fichier.
    for cle in ("../vue", "", "x" * 32, cle_de(lea_id).upper()):
        assert table_joueurs.pion_publie(config.PROPOSITIONS, cle, table_joueurs.vue_publiee(config.PROPOSITIONS))["pion"] is None


def test_le_bandeau_du_combat_et_la_main(atelier, monde):
    a, b = monde["aude"], monde["bertrand"]
    url = f"/api/seances/{monde['seance']['id']}/combat"
    combat = {"id": "c1", "nom": "Combat près de la Petite Fanfrelée", "tour": 2, "actif": 0, "strat": True,
              "ordre": [f"aventurier:{a['id']}", "ennemis", f"aventurier:{b['id']}"],
              "heros": [{"id": a["id"], "nom": "Aude", "max": 9, "sante": 4}, {"id": b["id"], "nom": "Bertrand", "max": 8, "sante": 8}],
              "adversaires": [{"id": "a1", "nom": "ADVERSAIRE-CHEF", "capacites": "CAPACITE-SECRETE", "sante": 30, "max": 30}],
              "version_base": None}
    assert atelier.put(url, json=combat).status_code == 200
    assert atelier.put(f"{url}/tv", json={"montrer": True}).status_code == 200
    montrer_plan(atelier, monde["plan"])
    atelier.put("/api/table-joueurs", json={"ouverte": True})
    lea, basile = monde["lea"].get("/api/table"), monde["basile"].get("/api/table")
    bandeau = lea.json()["vue"]["combat"]
    assert set(bandeau) == {"tour", "ordre", "actif", "strat"} and bandeau["actif"] == 0 and bandeau["strat"] is True
    assert [x.get("nom", x["genre"]) for x in bandeau["ordre"]] == ["Aude", "ennemis", "Bertrand"]
    assert lea.json()["mon_tour"] is True and basile.json()["mon_tour"] is False
    for texte in (lea.text, basile.text, tout_ce_qui_est_publie()):
        for interdit in ("ADVERSAIRE-", "CAPACITE-", "Fanfrel", "aventurier:", "sablier", "capacites", "adversaires"):
            assert interdit not in texte, interdit


def test_un_autre_plan_efface_l_ancien_fond(atelier, monde):
    montrer_plan(atelier, monde["plan"])
    atelier.put("/api/table-joueurs", json={"ouverte": True})
    avant = monde["lea"].get("/api/table").json()["vue"]["plan"]["fond"]["url"]
    nom = avant.rsplit("/", 1)[1]
    assert (TABLE / table_joueurs.MEDIA / nom).is_file()
    montrer_plan(atelier, monde["autre"])
    apres = monde["lea"].get("/api/table").json()
    assert apres["vue"]["plan"]["fond"]["url"] != avant and apres["pion"] is None
    assert not (TABLE / table_joueurs.MEDIA / nom).exists() and monde["lea"].get(avant).status_code == 404
    assert len(list((TABLE / table_joueurs.MEDIA).iterdir())) == 1
    # Un style inconnu envoyé à la TV ne passe pas tel quel : le plan reprend le sien.
    montrer_plan(atelier, monde["autre"], style="<b>peint</b>")
    assert monde["lea"].get("/api/table").json()["vue"]["style"] == "couleur"
    # Une autre vue : son genre, un titre public et l'écran de la TV (lot du 12/11 : l'état public sans caméra, et ce que la
    # TV lirait) ; plus aucune image, plus aucun pion. (Une carte du monde se publie, elle : test_table_joueurs_cartes.py.)
    assert atelier.put("/api/table", json={"vue": "planche", "camera": {"x": 1, "y": 1, "hv": 4}}).status_code == 200
    tv_etat.table_coin.tout_de_suite()
    r = monde["lea"].get("/api/table").json()
    assert {k: v for k, v in r["vue"].items() if k not in ("maj", "ecran")} == {"genre": "planche", "titre": "la planche à contrats"} and r["pion"] is None
    assert r["vue"]["ecran"]["etat"]["vue"] == "planche" and "camera" not in r["vue"]["ecran"]["etat"]
    assert list(r["vue"]["ecran"]["lectures"]) == ["/api/table/planche"]
    assert not list((TABLE / table_joueurs.MEDIA).iterdir()) and not list((TABLE / table_joueurs.PIONS).iterdir())
    # Une vue sans sa fiche (un plan effacé, une boutique sans boutique) : l'accueil, comme à la TV.
    atelier.put("/api/table", json={"vue": "plan", "plan": "plan-qui-n-existe-pas"})
    tv_etat.table_coin.tout_de_suite()
    assert monde["lea"].get("/api/table").json()["vue"]["genre"] == "accueil"
    atelier.put("/api/table", json={"vue": "boutique"})
    tv_etat.table_coin.tout_de_suite()
    assert monde["lea"].get("/api/table").json()["vue"]["titre"] == "l'écran d'accueil"
    # Refermée : il ne reste rien.
    atelier.put("/api/table-joueurs", json={"ouverte": False})
    assert not TABLE.exists() and monde["lea"].get("/api/table").json() == {"ouverte": False}


def test_un_media_au_nom_detourne(atelier, monde):
    montrer_plan(atelier, monde["plan"])
    atelier.put("/api/table-joueurs", json={"ouverte": True})
    vrai = monde["lea"].get("/api/table").json()["vue"]["plan"]["fond"]["url"].rsplit("/", 1)[1]
    cle = next(f.stem for f in (TABLE / table_joueurs.PIONS).glob("*.json"))
    for nom in ("../vue.json", "..%2Fvue.json", "%2e%2e%2fvue.json", "vue.json", f"../pions/{cle}.json", f"{cle}.json",
                vrai.upper(), vrai[:-4] + ".png", "0" * 24 + ".jpg", vrai + "x", "a" + vrai, ".x.jpg", "fond-table-essai.png",
                "%00", vrai.replace(".jpg", "%00.jpg"), "%2e%2e"):
        assert monde["lea"].get(f"/table/media/{nom}").status_code == 404, nom
    assert monde["lea"].get(f"/table/media/{vrai}").status_code == 200
    # Hors de la liste fermée du coin, rien de l'image ni des propositions.
    assert monde["lea"].get("/static/js/plan/editeur.js").status_code == 404
    assert monde["lea"].get(f"/static/../propositions/table/media/{vrai}").status_code == 404


def test_sans_session_401(atelier, monde, monkeypatch):
    montrer_plan(atelier, monde["plan"])
    atelier.put("/api/table-joueurs", json={"ouverte": True})
    vrai = monde["lea"].get("/api/table").json()["vue"]["plan"]["fond"]["url"]
    inconnu = nouveau_coin(monkeypatch)
    assert inconnu.get("/api/table").status_code == 401
    assert inconnu.get(vrai).status_code == 401
    assert inconnu.get("/table", follow_redirects=False).status_code == 303
    page = monde["lea"].get("/table")
    assert page.status_code == 200 and "table-coin.js" in page.text
    # Un cookie forgé n'y entre pas non plus.
    inconnu.cookies.set("aventurier", "v2.lea.1.9999999999.0000")
    assert inconnu.get("/api/table").status_code == 401


def test_la_tv_qui_change_republie_seule(atelier, monde):
    """Le chemin réel : la diffusion à la TV publie la table du coin d'elle-même, regroupée, sans la caméra."""
    atelier.put("/api/table-joueurs", json={"ouverte": True})
    atelier.put("/api/table", json={"vue": "accueil"})
    fin = time.monotonic() + 3
    while time.monotonic() < fin and (table_joueurs.vue_publiee(config.PROPOSITIONS) or {}).get("genre") != "accueil":
        time.sleep(0.05)
    # Le mode « Suivre » : la caméra bouge dix fois, la table n'est republiée qu'une fois, sans elle.
    for i in range(10):
        atelier.put("/api/table", json={"vue": "plan", "plan": monde["plan"]["id"], "camera": {"x": i, "y": 1, "hv": 5}})
    fin = time.monotonic() + 3
    while time.monotonic() < fin and (table_joueurs.vue_publiee(config.PROPOSITIONS) or {}).get("genre") != "plan":
        time.sleep(0.05)
    vue = table_joueurs.vue_publiee(config.PROPOSITIONS)
    assert vue["genre"] == "plan" and "camera" not in json.dumps(vue)
    maj = vue["maj"]
    atelier.put("/api/table", json={"vue": "plan", "plan": monde["plan"]["id"], "camera": {"x": 3, "y": 3, "hv": 9}})
    time.sleep(0.6)
    assert table_joueurs.vue_publiee(config.PROPOSITIONS)["maj"] == maj  # seule la caméra a bougé : rien de réécrit


def test_le_flux_du_coin_previent_la_page():
    assert flux_coin.sujet_du_fichier(("table", "vue.json")) == (None, "table")
    assert flux_coin.sujet_du_fichier(("table", "pions", "0" * 32 + ".json")) == (None, "table")
    assert flux_coin.sujet_du_fichier(("table", "media", "0" * 24 + ".jpg")) is None
    assert "table" in flux_coin.SUJETS


def test_le_reglage_du_mj_se_lit_bien():
    """Le bloc de l'onglet Table : les guillemets tiennent à leur texte (pas de « orphelin en fin de ligne), et l'exemple
    « La TV montre : la carte » se donne pour un exemple, pas pour ce que montre la TV en ce moment."""
    js = (Path(__file__).resolve().parent.parent / "app" / "static" / "js" / "joueurs" / "table-mj.js").read_text(encoding="utf-8")
    code = js[js.index("export function"):]
    assert "« " not in code and " »" not in code
    assert "par exemple «\\u00a0La TV montre : la carte\\u00a0»" in code
