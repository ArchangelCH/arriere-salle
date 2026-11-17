"""Les cartes dans la table du coin des joueurs : quand la TV montre une carte du monde, l'atelier publie pour le
coin la carte telle que la TV la reçoit, passée au masque, sans sa caméra ni le carton d'un lieu, et son fond peint en
JPEG. Rien de ce que la TV ne montre pas n'y entre : lieu inconnu, lieu ou nom caché, ce qui dort sous le brouillard,
secrets, notes, résumés et illustrations des lieux, marque « position à valider », groupe caché ou non montré, nom caché
de l'auberge. Changer de vue efface les anciens fichiers ; un média ne se sert que par un nom vérifié ; les modules servis
pour dessiner la carte ne portent rien de la campagne."""
import base64
import io
import os
import re
import sys
import tempfile
import time
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image, PngImagePlugin  # noqa: E402

import joueurs  # noqa: E402
import main  # noqa: E402
from api import application, config, tv_cartes, tv_etat  # noqa: E402
from commun import table_joueurs  # noqa: E402
from comptes_coin import entrer as entrer_au_coin  # noqa: E402

TABLE = config.PROPOSITIONS / table_joueurs.DOSSIER
L, H = 12, 8  # cases : le fond peint fait 96 × 64 pixels (8 par case)
# Ce qui ne doit jamais atteindre le coin.
SECRETS = ("SECRET-", "NOTE-", "RESUME-", "PROMPT-", "LIEU-INCONNU", "LIEU-CACHE", "SOUS-LA-BRUME", "ETIQUETTE-CACHEE",
           "ETIQUETTE-BRUME", "Fanfrel", "fanfrel", "a_valider", "camera", "illustration", "\"/media/", "/api/table/",
           "METADONNEE-CACHEE", "resume", "secrets", "notes")


def b64(octets: bytes) -> str:
    return base64.b64encode(octets).decode()


def png(l=L * 8, h=H * 8, texte=None) -> bytes:
    sortie = io.BytesIO()
    info = PngImagePlugin.PngInfo()
    if texte:
        info.add_text("Comment", texte)
    Image.new("RGB", (l, h), (96, 140, 70)).save(sortie, "PNG", pnginfo=info)
    return sortie.getvalue()


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
    """Un joueur entré au coin, des lieux de toutes sortes, une carte à secrets (brouillard à droite, x >= 8) et une carte
    peinte avec son fond. La table est ouverte ; tout repart à la fin."""
    crees, invites = [], []

    def creer(collection, **fiche):
        r = atelier.post(f"/api/{collection}", json=fiche)
        assert r.status_code == 200, r.text
        f = r.json()
        crees.append((collection, f["id"]))
        return f

    m = {}
    m["village"] = creer("lieux", nom="Village connu", type="village", connu=True, secrets="SECRET-DU-VILLAGE", notes="NOTE-VILLAGE",
                         resume="RESUME-VILLAGE", illustrations=[{"url": "/media/village-secret.png", "prompt": "PROMPT-VILLAGE"}])
    m["inconnu"] = creer("lieux", nom="LIEU-INCONNU", type="ville", connu=False, a_valider=True, secrets="SECRET-INCONNU")
    m["valider"] = creer("lieux", nom="Ville à placer", type="ville", connu=True, a_valider=True, notes="NOTE-A-VALIDER")
    m["brume"] = creer("lieux", nom="SOUS-LA-BRUME", type="tour", connu=True)
    m["cache"] = creer("lieux", nom="LIEU-CACHE", type="tour", connu=True)
    m["auberge"] = creer("lieux", nom="La Petite Fanfrelée", type="auberge", connu=True, notes="NOTE-AUBERGE")
    brouillard = bytes(1 if x < 8 else 0 for y in range(H) for x in range(L))
    m["carte"] = creer("cartes", nom="Carte du coin", largeur=L, hauteur=H, km_case=2, style="couleur", notes="NOTE-CARTE",
                       terrain=b64(bytes([1]) * (L * H)), brouillard=b64(brouillard), brouillard_actif=True,
                       marqueurs=[{"id": "m1", "lieu": m["village"]["id"], "x": 2, "y": 2},
                                  {"id": "m2", "lieu": m["inconnu"]["id"], "x": 3, "y": 5},
                                  {"id": "m3", "lieu": m["valider"]["id"], "x": 5, "y": 2},
                                  {"id": "m4", "lieu": m["brume"]["id"], "x": 10, "y": 3},
                                  {"id": "m5", "lieu": m["cache"]["id"], "x": 6, "y": 6, "cache": True},
                                  {"id": "m6", "lieu": m["auberge"]["id"], "x": 1, "y": 6}],
                       etiquettes=[{"texte": "Les Collines", "x": 3, "y": 3}, {"texte": "ETIQUETTE-CACHEE", "x": 4, "y": 4, "cache": True},
                                   {"texte": "ETIQUETTE-BRUME", "x": 10, "y": 6}],
                       traces=[{"id": "t1", "type": "route", "points": [[0, 0], [5, 5]]},
                               {"id": "t2", "type": "chemin", "points": [[1, 1], [2, 7]], "cache": True}],
                       groupe={"visible": True, "montrer": False, "x": 4, "y": 4, "trajet": [[1, 1], [4, 4]]})
    m["peinte"] = creer("cartes", nom="Carte peinte", largeur=L, hauteur=H, km_case=1, style="peint",
                        terrain=b64(bytes([1]) * (L * H)), brouillard=b64(bytes(L * H)),
                        marqueurs=[{"id": "p1", "lieu": m["village"]["id"], "x": 4, "y": 4}])
    m["plan"] = creer("plans", nom="Plan d'essai des cartes", largeur=3, hauteur=2, brouillard_actif=False, sol=[2] * 6,
                      piece=[1] * 6, pieces=[{"id": 1, "nom": "Cour", "genre": "salle"}], portes=[], objets=[], textes=[], pions=[],
                      fond={"url": image_plan(), "x": 0, "y": 0, "l": 3, "h": 2})
    invite = atelier.post("/api/joueurs", json={"nom": "Iris"}).json()
    invites.append(invite["id"])
    m["coin"] = nouveau_coin(monkeypatch)
    entrer_au_coin(m["coin"], invite)
    assert atelier.put("/api/table-joueurs", json={"ouverte": True}).status_code == 200
    yield m
    atelier.put("/api/table-joueurs", json={"ouverte": False})
    atelier.put("/api/table", json={"vue": "accueil"})
    for ident in invites:
        atelier.delete(f"/api/joueurs/{ident}")
    for collection, ident in reversed(crees):
        atelier.delete(f"/api/{collection}/{ident}")
    tv_etat.TABLE_JOUEURS.unlink(missing_ok=True)
    table_joueurs.fermer(config.PROPOSITIONS)


def image_plan() -> str:
    Image.new("RGB", (30, 20), (90, 90, 90)).save(config.IMAGES / "fond-plan-des-cartes.png")
    return "/media/fond-plan-des-cartes.png"


def montrer(atelier, etat: dict) -> dict:
    assert atelier.put("/api/table", json=etat).status_code == 200
    return tv_etat.table_coin.tout_de_suite()


def montrer_carte(atelier, carte, **en_plus) -> dict:
    return montrer(atelier, {"vue": "carte", "carte": carte["id"], "camera": {"x": 3, "y": 3, "hv": 5}, **en_plus})


def tout_ce_qui_est_publie() -> str:
    morceaux = []
    for f in sorted(TABLE.rglob("*")):
        if f.is_file():
            morceaux.append(f.name if f.suffix == ".jpg" else f.read_text(encoding="utf-8"))
    return "\n".join(morceaux)


def medias() -> list:
    return sorted(f.name for f in (TABLE / table_joueurs.MEDIA).iterdir()) if (TABLE / table_joueurs.MEDIA).exists() else []


def deposer_fond(atelier, carte, contenu=None, version=None):
    if version is None:
        version = atelier.get(f"/api/cartes/{carte['id']}/publique").json()["modifie"]
    return atelier.put(f"/api/cartes/{carte['id']}/fond", params={"version": version, "echelle": 8},
                       content=contenu or png(texte="METADONNEE-CACHEE"), headers={"Content-Type": "image/png"})


def modifier(atelier, carte, changer):
    fiche = atelier.get(f"/api/cartes/{carte['id']}").json()
    changer(fiche)
    r = atelier.put(f"/api/cartes/{carte['id']}", json={**fiche, "version_base": fiche["modifie"]})
    assert r.status_code == 200, r.text
    return r.json()


def test_la_carte_publiee_sans_rien_de_cache(atelier, monde):
    # La TV montre la carte, avec la caméra du MJ et le carton d'un lieu inconnu (un oubli du MJ) : rien de cela ne passe.
    r = montrer_carte(atelier, monde["carte"], lieu=monde["inconnu"]["id"], style="couleur")
    assert r == {"ouverte": True, "genre": "carte", "pions": 0}
    lu = monde["coin"].get("/api/table")
    v = lu.json()["vue"]
    assert set(v) == {"maj", "genre", "titre", "style", "carte", "ecran"} and (v["genre"], v["titre"], v["style"]) == ("carte", "la carte", "couleur")
    # L'écran de la TV publié avec la carte (lot du 12/11) : ni caméra, ni version, ni le lieu inconnu, même sous son jeton.
    assert v["ecran"]["lectures"] == {} and v["ecran"]["etat"]["lieu"] is None
    assert "camera" not in v["ecran"]["etat"] and "version" not in v["ecran"]["etat"]
    assert lu.json()["pion"] is None and not medias() and not list((TABLE / table_joueurs.PIONS).iterdir())
    c = v["carte"]
    # Les lieux montrés à la TV seulement, réduits à ce que le dessin lit : nom et genre, sous un jeton.
    assert sorted(x["nom"] for x in c["lieux"].values()) == ["L'auberge", "Village connu", "Ville à placer"]
    assert all(set(x) == {"id", "nom", "type"} and tv_cartes.JETON_VALIDE.match(x["id"]) for x in c["lieux"].values())
    assert sorted(x["lieu"] for x in c["marqueurs"]) == sorted(c["lieux"])
    assert [e["texte"] for e in c["etiquettes"]] == ["Les Collines"]
    assert [t["type"] for t in c["traces"]] == ["route"]
    assert "groupe" not in c  # visible, mais pas montré aux joueurs
    texte = "\n".join((tout_ce_qui_est_publie(), lu.text))
    for interdit in SECRETS + tuple(monde[k]["id"] for k in ("village", "inconnu", "valider", "brume", "cache", "auberge", "carte")) + (
            tv_cartes.jeton("lieux", monde["inconnu"]["id"]), tv_cartes.jeton("lieux", monde["brume"]["id"])):
        assert interdit not in texte, interdit
    # Le groupe montré : il paraît, avec son trajet ; rendu invisible, il disparaît.
    m = modifier(atelier, monde["carte"], lambda f: f["groupe"].update(montrer=True))
    montrer_carte(atelier, monde["carte"], version=m["modifie"])
    assert monde["coin"].get("/api/table").json()["vue"]["carte"]["groupe"] == {"x": 4, "y": 4, "visible": True, "montrer": True, "trajet": [[1, 1], [4, 4]]}
    m = modifier(atelier, monde["carte"], lambda f: f["groupe"].update(visible=False))
    montrer_carte(atelier, monde["carte"], version=m["modifie"])
    assert "groupe" not in monde["coin"].get("/api/table").json()["vue"]["carte"]
    # Le brouillard levé : le lieu qui y dormait paraît, comme à la TV.
    m = modifier(atelier, monde["carte"], lambda f: f.update(brouillard_actif=False))
    montrer_carte(atelier, monde["carte"], version=m["modifie"])
    assert "SOUS-LA-BRUME" in [x["nom"] for x in monde["coin"].get("/api/table").json()["vue"]["carte"]["lieux"].values()]
    # Sans session, rien.
    assert TestClient(joueurs.app).get("/api/table").status_code == 401


def test_la_carte_du_coin_est_celle_de_la_tv(atelier, monde):
    """Mêmes lieux, mêmes marqueurs, mêmes tracés que la carte publique de la TV : le coin n'en a ni plus, ni autre chose."""
    montrer_carte(atelier, monde["carte"])
    c = monde["coin"].get("/api/table").json()["vue"]["carte"]
    tv = atelier.get(f"/api/table/carte/{tv_cartes.jeton('cartes', monde['carte']['id'])}").json()
    for cle in ("marqueurs", "etiquettes", "traces", "terrain", "brouillard", "brouillard_actif", "largeur", "hauteur", "decor", "modifie"):
        assert c.get(cle) == tv.get(cle), cle
    assert {j: (x["nom"], x["type"]) for j, x in c["lieux"].items()} == {j: (x["nom"], x["type"]) for j, x in tv["lieux"].items()}
    assert set(c) <= set(tv) | {"fond_peint"}


def test_le_fond_peint_part_en_jpeg(atelier, monde):
    peinte = monde["peinte"]
    montrer_carte(atelier, peinte)
    assert "fond_peint" not in monde["coin"].get("/api/table").json()["vue"]["carte"] and not medias()  # pas encore de fond
    # Le fond déposé par l'atelier republie la table du coin, sans attendre la TV.
    assert deposer_fond(atelier, peinte).status_code == 200
    fin = time.monotonic() + 3
    while time.monotonic() < fin and "fond_peint" not in ((table_joueurs.vue_publiee(config.PROPOSITIONS) or {}).get("carte") or {}):
        time.sleep(0.05)
    v = monde["coin"].get("/api/table").json()["vue"]
    fond = v["carte"]["fond_peint"]
    assert v["style"] == "peint" and set(fond) == {"url", "nouveaux"} and fond["url"].startswith("/table/media/")
    nom = fond["url"].rsplit("/", 1)[1]
    assert table_joueurs.NOM_MEDIA.match(nom) and medias() == [nom]
    r = monde["coin"].get(fond["url"])
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    with Image.open(io.BytesIO(r.content)) as im:
        assert im.format == "JPEG" and im.size == (L * 8, H * 8)
    assert b"METADONNEE-CACHEE" not in r.content
    # La TV montre la carte en couleur : pas de fond peint, pas d'image.
    montrer_carte(atelier, peinte, style="couleur")
    assert "fond_peint" not in monde["coin"].get("/api/table").json()["vue"]["carte"] and not medias()
    assert monde["coin"].get(fond["url"]).status_code == 404
    # Un lieu ajouté depuis : le même fond, avec ce qui s'est ajouté à repeindre.
    m = modifier(atelier, peinte, lambda f: f["marqueurs"].append({"id": "p2", "lieu": monde["valider"]["id"], "x": 8, "y": 2}))
    montrer_carte(atelier, peinte, version=m["modifie"])
    fond2 = monde["coin"].get("/api/table").json()["vue"]["carte"]["fond_peint"]
    assert fond2["url"] == fond["url"] and fond2["nouveaux"]["marqueurs"] == [1]
    # Un lieu caché depuis : le fond le montrerait encore, il ne part plus.
    m = modifier(atelier, peinte, lambda f: f["marqueurs"][0].update(cache=True))
    montrer_carte(atelier, peinte, version=m["modifie"])
    assert "fond_peint" not in monde["coin"].get("/api/table").json()["vue"]["carte"] and not medias()


def test_changer_de_vue_efface_les_anciens_fichiers(atelier, monde):
    peinte = monde["peinte"]
    assert deposer_fond(atelier, peinte).status_code == 200
    montrer_carte(atelier, peinte)
    carte = monde["coin"].get("/api/table").json()["vue"]["carte"]["fond_peint"]["url"]
    assert medias() == [carte.rsplit("/", 1)[1]]
    # Un plan : le fond de la carte s'en va, celui du plan arrive.
    montrer(atelier, {"vue": "plan", "plan": monde["plan"]["id"]})
    v = monde["coin"].get("/api/table").json()["vue"]
    assert v["genre"] == "plan" and "carte" not in v and medias() == [v["plan"]["fond"]["url"].rsplit("/", 1)[1]]
    assert monde["coin"].get(carte).status_code == 404
    plan = v["plan"]["fond"]["url"]
    # La carte de nouveau, puis l'accueil : plus rien.
    montrer_carte(atelier, peinte)
    assert medias() == [carte.rsplit("/", 1)[1]] and monde["coin"].get(plan).status_code == 404
    montrer(atelier, {"vue": "accueil"})
    assert monde["coin"].get("/api/table").json()["vue"]["genre"] == "accueil" and not medias()
    assert monde["coin"].get(carte).status_code == 404
    # Une carte qui n'existe pas (effacée) : l'accueil, comme à la TV.
    montrer(atelier, {"vue": "carte", "carte": "carte-effacee"})
    assert monde["coin"].get("/api/table").json()["vue"]["genre"] == "accueil" and not medias()
    # La table refermée : il ne reste rien.
    atelier.put("/api/table-joueurs", json={"ouverte": False})
    assert not TABLE.exists() and monde["coin"].get("/api/table").json() == {"ouverte": False}


def test_un_media_de_carte_au_nom_detourne(atelier, monde):
    assert deposer_fond(atelier, monde["peinte"]).status_code == 200
    montrer_carte(atelier, monde["peinte"])
    vrai = monde["coin"].get("/api/table").json()["vue"]["carte"]["fond_peint"]["url"].rsplit("/", 1)[1]
    ident = monde["peinte"]["id"]
    for nom in ("../vue.json", "..%2Fvue.json", "%2e%2e%2fvue.json", "vue.json", vrai.upper(), vrai[:-4] + ".png",
                "0" * 24 + ".jpg", vrai + "x", "a" + vrai, ".x.jpg", f"{ident}.png", f"../../fonds-peints/{ident}.png",
                "%00", vrai.replace(".jpg", "%00.jpg"), "%2e%2e"):
        assert monde["coin"].get(f"/table/media/{nom}").status_code == 404, nom
    assert monde["coin"].get(f"/table/media/{vrai}").status_code == 200
    assert TestClient(joueurs.app).get(f"/table/media/{vrai}").status_code == 401
    # Le fond de la TV, par son jeton, n'est pas une route du coin.
    assert monde["coin"].get(f"/api/table/carte/{tv_cartes.jeton('cartes', ident)}/fond").status_code == 404


def test_les_modules_de_la_carte_ne_portent_rien_de_la_campagne(monkeypatch):
    coin = nouveau_coin(monkeypatch)
    for chemin in ("js/joueurs/carte-coin.js", "js/carte/vue.js", "js/carte/peint-worker.js"):
        assert coin.get(f"/static/{chemin}").status_code == 200, chemin
    # La géographie de la campagne (lieux, secrets, vrai nom de l'auberge : campagne/carte.js et campagne/pays.js), le
    # générateur et l'éditeur restent à l'atelier.
    # (js/table.js, l'écran de la TV, est servi au coin depuis le lot du 12/11 : la page Table le tient dans un cadre.)
    for chemin in ("js/campagne/carte.js", "js/campagne/pays.js", "js/carte/saison4.js", "js/carte/generateur.js", "js/carte/editeur.js",
                   "tv/peint-worker.js"):
        assert coin.get(f"/static/{chemin}").status_code == 404, chemin
    statique = Path(joueurs.__file__).resolve().parent / "static"
    campagne = "".join((statique / f"js/campagne/{nom}.js").read_text(encoding="utf-8") for nom in ("carte", "pays"))
    # Les noms de lieux de la campagne (celle d'exemple ou celle d'un pack), lus dans ses modules mêmes.
    noms = {n for n in re.findall(r'\bnom: "([^"]{4,})"', campagne) if not n.islower()}
    assert len(noms) > 5 and "secrets:" in campagne  # ce que le test garde vraiment hors du coin
    dessin = [f for f in joueurs.FICHIERS if f.endswith(".js") and f.startswith(("js/carte/", "js/plan/", "js/joueurs/carte-coin", "js/joueurs/table-coin"))]
    for f in dessin:
        source = (statique / f).read_text(encoding="utf-8")
        for interdit in (*noms, "secrets:", "saison4", "campagne/carte", "campagne/pays"):
            assert interdit not in source, f"{f} : {interdit}"


def test_le_flux_previent_la_page_d_une_carte():
    """La carte publiée est la vue de la table : le flux du coin réveille la page (sujet « table »), pas pour son image."""
    from commun import flux_coin

    assert flux_coin.sujet_du_fichier(("table", "vue.json")) == (None, "table")
    assert flux_coin.sujet_du_fichier(("table", "media", "0" * 24 + ".jpg")) is None


def test_le_fond_converti_une_fois(tmp_path):
    chemin = tmp_path / "fond.png"
    chemin.write_bytes(png())
    a = table_joueurs.fond_en_jpeg(chemin, "cle")
    assert a and a[:2] == b"\xff\xd8" and table_joueurs.fond_en_jpeg(chemin, "cle") is a
    assert table_joueurs.fond_en_jpeg(tmp_path / "absent.png", "cle") is None
    (tmp_path / "abime.png").write_bytes(b"pas une image")
    assert table_joueurs.fond_en_jpeg(tmp_path / "abime.png", "cle") is None
    assert len(table_joueurs.FONDS_CARTES) <= 3
