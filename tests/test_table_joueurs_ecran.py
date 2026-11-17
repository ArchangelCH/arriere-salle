"""Tout l'écran de la TV sur la table du coin des joueurs (lot du 12/11, tv_etat.ecran_pour_le_coin, joueurs/ecran.html) :
pour chaque scène et chaque couche, le coin publie la projection même que lit la TV, et rien de plus. Un PNJ ou un lieu
inconnus, un secret, le vrai nom de l'auberge, un contrat pas affiché, un article caché, un document qui n'est plus à
l'écran ne sortent jamais ; aucune adresse /media/ de l'atelier ne reste ; la page de l'écran ne se laisse encadrer que par
le coin."""
import json
import os
import re
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from commun import table_joueurs  # noqa: E402
import joueurs  # noqa: E402
from comptes_coin import entrer  # noqa: E402
import main  # noqa: E402, F401
from api import application, config, tv_cartes, tv_etat  # noqa: E402
from table import lectures_publiques  # noqa: E402

TABLE = config.PROPOSITIONS / table_joueurs.DOSSIER
STATIQUE = Path(joueurs.__file__).resolve().parent / "static"
SECRETS = ("SECRET-", "NOTE-", "Gorvak", "Sombrefer", "LIEU-INCONNU", "CONTRAT-CACHE", "ARTICLE-CACHE", "Fanfrel", "Brumes", "RUMEUR-TUE",
           "DOCUMENT-RANGE", "aventurier:")
MEDIA = re.compile(r"/table/media/[a-f0-9]{24}\.(?:jpg|png)|/media/[A-Za-z0-9][A-Za-z0-9._-]*")


def image(nom, taille=(120, 80), couleur=(200, 60, 40)):
    config.IMAGES.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", taille, couleur).save(config.IMAGES / nom)
    return f"/media/{nom}"


def J(collection, fiche):
    return tv_cartes.jeton(collection, fiche["id"])


@pytest.fixture(scope="module")
def atelier():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture(scope="module")
def monde(atelier):
    patch = pytest.MonkeyPatch()
    patch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    patch.setattr(joueurs, "COOKIE_SUR", False)
    patch.setattr(joueurs, "HOTES", set())
    crees = []

    def creer(collection, **fiche):
        r = atelier.post(f"/api/{collection}", json=fiche)
        assert r.status_code in (200, 201), r.text
        crees.append((collection, r.json()["id"]))
        return r.json()

    portrait, paysage = image("ecran-portrait.png", (60, 90)), image("ecran-paysage.jpg", (2400, 900), (40, 90, 60))
    m = {"paysage": paysage}
    m["aude"] = creer("aventuriers", nom="Aude de Valcombe", genre="f", joueur="Léa", tablee=True, couleur="#2e7d32", physique=55, social=45,
                      mental=50, sante=9, psy=4, peuple="Fils des Brumes", peuple_cache=True, secret="SECRET-AUDE", notes_mj="NOTE-MJ-AUDE",
                      illustrations=[{"url": portrait}], illustration=portrait, competences=[{"nom": "Athlétisme", "bonus": 10}])
    m["connu"] = creer("pnj", nom="Maître Corbin", connu=True, role="Tavernier", apparence="Un grand gaillard de la Petite Fanfrelée.",
                       secret="SECRET-CORBIN", notes_mj="NOTE-CORBIN", illustrations=[{"url": portrait}], illustration=portrait)
    m["inconnu"] = creer("pnj", nom="Gorvak Sombrefer", connu=False, role="Chef de bande", secret="SECRET-GORVAK")
    m["lieu"] = creer("lieux", nom="Le moulin", type="village", connu=True, resume="Un moulin sur la rivière.", secrets="SECRET-DU-MOULIN",
                      illustrations=[{"url": paysage}], illustration=paysage)
    m["lieu_inconnu"] = creer("lieux", nom="LIEU-INCONNU", type="ruines", connu=False, resume="SECRET-RUINES")
    m["contrat"] = creer("contrats", nom="Les loups du gué", genre="chasse", affiche="Trois loups rôdent près du gué.", recompense="12 pièces",
                         contact="Le bailli", etat="affiche", notes_mj="NOTE-CONTRAT")
    m["contrat_cache"] = creer("contrats", nom="CONTRAT-CACHE", genre="chasse", affiche="SECRET-AFFICHE", etat="brouillon")
    m["rumeur"] = creer("rumeurs", texte="On dit que Gorvak rôde au gué.", source="Un colporteur", etat="entendue", notes_mj="NOTE-RUMEUR")
    m["document"] = creer("documents", nom="La lettre de Bran", genre="lettre", texte="Frère,\n\nNous dormirons à la Petite Fanfrelée, puis le gué.",
                          signature="Bran", notes_mj="NOTE-DOC", image=paysage)
    m["document_range"] = creer("documents", nom="DOCUMENT-RANGE", genre="lettre", texte="SECRET-LETTRE", signature="X")
    m["boutique"] = creer("boutiques", nom="Le Comptoir du Gué", accroche="Tout pour la route", marchand="", lieu="", ajustement=0,
                          notes_mj="NOTE-BOUTIQUE", articles=[
                              {"id": "a1", "nom": "Corde", "prix": 2, "categorie": "Voyage", "description": "Solide.", "note_mj": "NOTE-ARTICLE", "stock": None, "cache": False},
                              {"id": "a2", "nom": "ARTICLE-CACHE", "prix": 99, "categorie": "Voyage", "description": "", "note_mj": "", "stock": None, "cache": True}])
    m["seance"] = creer("seances", nom="SECRET-NOM-DE-SEANCE", titre_episode="Le gué aux loups", numero=3, date="2026-12-06",
                        precedemment="Nos héros ont quitté la Petite Fanfrelée à l'aube.", notes="NOTE-SEANCE", lieux=[m["lieu"]["id"], m["lieu_inconnu"]["id"]],
                        illustrations=[{"url": paysage}], illustration=paysage)
    invite = atelier.post("/api/joueurs", json={"nom": "Léa"}).json()
    assert atelier.post(f"/api/joueurs/{invite['id']}/relier", json={"heros": m["aude"]["id"]}).status_code == 200
    coin = TestClient(joueurs.app)
    entrer(coin, invite)
    m["coin"], m["joueur"] = coin, invite
    assert atelier.put("/api/table-joueurs", json={"ouverte": True}).status_code == 200
    yield m
    atelier.put("/api/table-joueurs", json={"ouverte": False})
    atelier.put("/api/table", json={"vue": "accueil"})
    coin.close()
    atelier.delete(f"/api/joueurs/{invite['id']}")
    for collection, ident in reversed(crees):
        atelier.delete(f"/api/{collection}/{ident}")
    tv_etat.TABLE_JOUEURS.unlink(missing_ok=True)
    table_joueurs.fermer(config.PROPOSITIONS)
    patch.undo()


def montrer(atelier, monde, **etat):
    """Met la TV dans cet état, publie, et rend (ce que lit le joueur, l'écran publié, tout le texte publié)."""
    assert atelier.put("/api/table", json=etat).status_code == 200
    tv_etat.table_coin.tout_de_suite()
    r = monde["coin"].get("/api/table")
    assert r.status_code == 200, r.text
    publie = "\n".join(f.name if f.suffix in (".jpg", ".png") else f.read_text(encoding="utf-8") for f in sorted(TABLE.rglob("*")) if f.is_file())
    return r.json(), r.json()["vue"]["ecran"], publie + "\n" + r.text


def sans_medias(contenu):
    return json.loads(MEDIA.sub("MEDIA", json.dumps(contenu, ensure_ascii=False)))


def comme_a_la_tv(atelier, ecran):
    """Chaque lecture publiée est celle que rend la route de la TV au même instant (aux adresses des images près, et sans le
    sablier du combat) ; et chaque lecture que la table publique laisserait faire, hors carte et plan, est publiée ou
    refusée par la TV elle-même."""
    for chemin, contenu in ecran["lectures"].items():
        tv = atelier.get(chemin)
        assert tv.status_code == 200, chemin
        attendu = tv.json()
        if chemin.startswith("/api/table/combat/"):
            attendu.pop("sablier", None)
        assert sans_medias(contenu) == sans_medias(attendu), chemin
    from api import tv_ecran
    for chemin in lectures_publiques.chemins_montres(tv_ecran.etat_table(), tv_cartes.jeton):
        if chemin.split("/")[3] in ("carte", "plan"):
            continue
        assert (chemin in ecran["lectures"]) == (atelier.get(chemin).status_code == 200), chemin


def rien_de_secret(monde, texte):
    for interdit in SECRETS + tuple(monde[k]["id"] for k in ("aude", "connu", "inconnu", "lieu", "lieu_inconnu", "contrat", "contrat_cache",
                                                             "document", "document_range", "boutique", "seance")):
        assert interdit not in texte, interdit
    # Aucune adresse de l'atelier : le coin ne sert pas /media/.
    assert not re.search(r'(?<!/table)/media/', texte), re.search(r'.{40}(?<!/table)/media/.{40}', texte)
    assert "camera" not in texte and "sablier" not in texte


def images_servies(monde, ecran):
    adresses = set(re.findall(r"/table/media/[a-f0-9]{24}\.(?:jpg|png)", json.dumps(ecran)))
    for a in adresses:
        r = monde["coin"].get(a)
        assert r.status_code == 200 and r.headers["content-type"] in ("image/jpeg", "image/png"), a
    return adresses


# ---------------------------------------------------------------- chaque scène

def test_l_accueil_et_la_prochaine_seance(atelier, monde):
    r, ecran, texte = montrer(atelier, monde, vue="accueil", camera={"x": 1, "y": 2, "hv": 3})
    assert r["vue"]["genre"] == "accueil" and ecran["etat"]["vue"] == "accueil" and ecran["lectures"] == {}
    assert ecran["etat"]["prochaine"].startswith("dimanche 6 décembre")
    rien_de_secret(monde, texte)
    # Une vue sans sa fiche revient à l'accueil, comme à la TV.
    _, ecran, _ = montrer(atelier, monde, vue="boutique")
    assert ecran["etat"]["vue"] == "accueil" and ecran["lectures"] == {}


def test_une_image(atelier, monde):
    _, ecran, texte = montrer(atelier, monde, vue="image", url=monde["paysage"], titre="Devant la Petite Fanfrelée")
    assert ecran["etat"]["vue"] == "image" and ecran["etat"]["titre"] == "Devant l'auberge"
    assert ecran["etat"]["url"].startswith("/table/media/") and images_servies(monde, ecran) == {ecran["etat"]["url"]}
    # Réduite pour une tablette : 1600 pixels de large au plus, jamais l'original de 2400.
    lue = Image.open(__import__("io").BytesIO(monde["coin"].get(ecran["etat"]["url"]).content))
    assert lue.size == (1600, 600)
    rien_de_secret(monde, texte)
    # Une image qui n'existe pas : pas d'adresse, l'accueil.
    r, ecran, texte = montrer(atelier, monde, vue="image", url="/media/absente.jpg", titre="x")
    assert not ecran["etat"].get("url") and "/media/" not in texte.replace("/table/media/", "")


def test_un_document_seulement_a_l_ecran(atelier, monde):
    _, ecran, texte = montrer(atelier, monde, vue="document", document=monde["document"]["id"])
    chemin = f"/api/table/document/{J('documents', monde['document'])}"
    assert list(ecran["lectures"]) == [chemin]
    d = ecran["lectures"][chemin]
    assert d["nom"] == "La lettre de Bran" and "l'auberge" in d["texte"] and d["image"].startswith("/table/media/") and "notes_mj" not in d
    comme_a_la_tv(atelier, ecran)
    images_servies(monde, ecran)
    rien_de_secret(monde, texte)
    # Plus à l'écran (la TV montre autre chose, le document reste dans l'état) : il ne sort plus, ni lui ni son jeton.
    _, ecran, texte = montrer(atelier, monde, vue="planche", document=monde["document_range"]["id"])
    assert not any("document" in c for c in ecran["lectures"]) and ecran["etat"].get("document") is None
    assert J("documents", monde["document_range"]) not in texte and "La lettre de Bran" not in texte
    rien_de_secret(monde, texte)


def test_le_carton_d_un_pnj_connu_jamais_d_un_inconnu(atelier, monde):
    _, ecran, texte = montrer(atelier, monde, vue="accueil", pnj=monde["connu"]["id"])
    chemin = f"/api/table/pnj/{J('pnj', monde['connu'])}"
    assert list(ecran["lectures"]) == [chemin] and ecran["etat"]["pnj"] == J("pnj", monde["connu"])
    p = ecran["lectures"][chemin]
    assert p["nom"] == "Maître Corbin" and "l'auberge" in p["apparence"] and p["illustration"].startswith("/table/media/")
    comme_a_la_tv(atelier, ecran)
    rien_de_secret(monde, texte)
    # Un inconnu montré par mégarde : la TV le refuse, le coin aussi, et son jeton même ne sort pas.
    _, ecran, texte = montrer(atelier, monde, vue="accueil", pnj=monde["inconnu"]["id"])
    assert ecran["lectures"] == {} and ecran["etat"]["pnj"] is None and J("pnj", monde["inconnu"]) not in texte
    rien_de_secret(monde, texte)


def test_la_boutique_sans_ses_articles_caches(atelier, monde):
    _, ecran, texte = montrer(atelier, monde, vue="boutique", boutique=monde["boutique"]["id"])
    b = ecran["lectures"][f"/api/table/boutique/{J('boutiques', monde['boutique'])}"]
    assert b["nom"] == "Le Comptoir du Gué" and [a["nom"] for a in b["articles"]] == ["Corde"]
    comme_a_la_tv(atelier, ecran)
    rien_de_secret(monde, texte)


def test_la_tablee_et_les_fiches(atelier, monde):
    for vue in ("heros", "fiches"):
        _, ecran, texte = montrer(atelier, monde, vue=vue)
        liste = ecran["lectures"][f"/api/table/{vue}"]
        aude = next(a for a in liste if a["nom"] == "Aude de Valcombe")
        # Le peuple gardé secret ne part pas ; le portrait passe par les médias de la table.
        assert not aude.get("peuple") and aude["illustration"].startswith("/table/media/")
        comme_a_la_tv(atelier, ecran)
        images_servies(monde, ecran)
        rien_de_secret(monde, texte)
    # Le carton d'un héros, posé sur n'importe quelle vue.
    _, ecran, texte = montrer(atelier, monde, vue="accueil", aventurier=monde["aude"]["id"])
    assert list(ecran["lectures"]) == [f"/api/table/aventurier/{J('aventuriers', monde['aude'])}"]
    comme_a_la_tv(atelier, ecran)
    rien_de_secret(monde, texte)


def test_la_planche_seulement_les_contrats_affiches(atelier, monde):
    _, ecran, texte = montrer(atelier, monde, vue="planche", contrat=monde["contrat_cache"]["id"])
    planche = ecran["lectures"]["/api/table/planche"]
    # (D'autres essais ont pu laisser leurs contrats affichés : seuls comptent les deux d'ici.)
    noms = [c["nom"] for c in planche]
    assert "Les loups du gué" in noms and "CONTRAT-CACHE" not in noms and ecran["etat"]["contrat"] is None
    assert J("contrats", monde["contrat_cache"]) not in texte
    comme_a_la_tv(atelier, ecran)
    rien_de_secret(monde, texte)
    # Un contrat affiché montré de près garde son jeton.
    _, ecran, _ = montrer(atelier, monde, vue="planche", contrat=monde["contrat"]["id"])
    assert ecran["etat"]["contrat"] == J("contrats", monde["contrat"])
    # Hors de la planche, elle ne se lit pas (comme sur la table publique).
    _, ecran, _ = montrer(atelier, monde, vue="accueil")
    assert "/api/table/planche" not in ecran["lectures"]


def test_le_sanctuaire_le_precedemment_et_l_episode(atelier, monde):
    _, ecran, texte = montrer(atelier, monde, vue="sanctuaire")
    assert list(ecran["lectures"]) == ["/api/table/sanctuaire"] and "batiments" in ecran["lectures"]["/api/table/sanctuaire"]
    comme_a_la_tv(atelier, ecran)
    rien_de_secret(monde, texte)
    j = J("seances", monde["seance"])
    _, ecran, texte = montrer(atelier, monde, vue="precedemment", seance=monde["seance"]["id"])
    p = ecran["lectures"][f"/api/table/precedemment/{j}"]
    # Le récit au masque ; des lieux de la séance, seulement le connu, avec son image publiée.
    assert "l'auberge" in p["texte"] and [i["nom"] for i in p["images"]] == ["Le moulin"] and p["images"][0]["url"].startswith("/table/media/")
    comme_a_la_tv(atelier, ecran)
    images_servies(monde, ecran)
    rien_de_secret(monde, texte)
    _, ecran, texte = montrer(atelier, monde, vue="episode", seance=monde["seance"]["id"])
    e = ecran["lectures"][f"/api/table/episode/{j}"]
    assert e["titre"] == "Le gué aux loups" and e["numero"] == 3 and e["image"].startswith("/table/media/")
    comme_a_la_tv(atelier, ecran)
    rien_de_secret(monde, texte)


def test_les_couches_sur_un_plan_rumeur_horloges_reserve(atelier, monde):
    plan = atelier.post("/api/plans", json={"nom": "Cour d'essai", "largeur": 3, "hauteur": 2, "brouillard_actif": False, "sol": [2] * 6, "piece": [1] * 6,
                                            "pieces": [{"id": 1, "nom": "Cour", "genre": "salle"}], "portes": [], "objets": [], "textes": [], "pions": []}).json()
    h = atelier.post("/api/horloges", json={"nom": "Gorvak approche", "parts": 4}).json()["horloges"][-1]
    h2 = atelier.post("/api/horloges", json={"nom": "Le toit va céder", "parts": 6}).json()["horloges"][-1]
    try:
        for x in (h, h2):
            assert atelier.patch(f"/api/horloges/{x['id']}", json={"visible": True}).status_code == 200
        r, ecran, texte = montrer(atelier, monde, vue="plan", plan=plan["id"], rumeur=monde["rumeur"]["id"], pnj=monde["connu"]["id"],
                                  camera={"x": 1, "y": 1, "hv": 4})
        assert r["vue"]["genre"] == "plan" and ecran["etat"]["vue"] == "plan"
        # Le plan garde sa publication à lui : l'écran n'en porte que les couches, sans version ni caméra.
        assert sorted(c.split("/")[3] for c in ecran["lectures"]) == ["pnj", "rumeur"]
        assert "version" not in ecran["etat"] and "camera" not in ecran["etat"] and "combat" not in ecran["etat"]
        noms = [x["nom"] for x in ecran["etat"]["horloges"]]
        assert "Le toit va céder" in noms and all(set(x) == {"id", "nom", "parts", "remplies"} for x in ecran["etat"]["horloges"])
        comme_a_la_tv(atelier, ecran)
        # La rumeur nomme un inconnu : elle part telle que la TV la montre (le MJ en a été averti), ses notes jamais.
        assert "NOTE-RUMEUR" not in texte and "SECRET-" not in texte and "Fanfrel" not in texte
    finally:
        for x in (h, h2):
            atelier.delete(f"/api/horloges/{x['id']}")
        atelier.put("/api/table", json={"vue": "accueil"})
        atelier.delete(f"/api/plans/{plan['id']}")


def test_le_carton_d_un_lieu_sur_la_carte(atelier, monde):
    carte = next(iter(atelier.get("/api/cartes").json()), None)
    if carte is None:
        pytest.skip("aucune carte dans les données d'essai")
    for lieu, attendu in ((monde["lieu"], True), (monde["lieu_inconnu"], False)):
        _, ecran, texte = montrer(atelier, monde, vue="carte", carte=carte["id"], lieu=lieu["id"])
        chemin = f"/api/table/lieu/{J('lieux', lieu)}"
        assert (chemin in ecran["lectures"]) is attendu and (ecran["etat"]["lieu"] is not None) is attendu
        assert attendu or J("lieux", lieu) not in texte
        comme_a_la_tv(atelier, ecran)
        for interdit in ("SECRET-", "LIEU-INCONNU"):
            assert interdit not in json.dumps(ecran, ensure_ascii=False), interdit


# ---------------------------------------------------------------- la page de l'écran, au coin

def corps(html: str) -> str:
    debut, fin = html.index("<body"), html.index("<script")
    return re.sub(r"\s*<!--.*?-->\s*$", "", html[debut:fin].rstrip(), flags=re.S).strip()


def test_l_ecran_du_coin_est_la_page_de_la_tv(monde):
    tv = (STATIQUE / "table.html").read_text(encoding="utf-8")
    ecran = (STATIQUE / "joueurs" / "ecran.html").read_text(encoding="utf-8")
    # Le même corps : un élément ajouté à la TV doit l'être ici (les modules de js/table/ le cherchent au chargement).
    assert corps(tv) == corps(ecran)
    assert set(re.findall(r'href="(/static/css/[^"]+)"', tv)) == set(re.findall(r'href="(/static/css/[^"]+)"', ecran))
    assert 'data-source="coin"' in ecran and '<script type="module" src="/static/js/table.js"></script>' in ecran
    # Tout ce qu'elle charge est dans la liste du coin : ses feuilles et tout le graphe de js/table.js.
    for feuille in re.findall(r'href="/static/(css/[^"]+)"', ecran):
        assert feuille in joueurs.FICHIERS, feuille
    vus, pile = set(), ["js/table.js"]
    while pile:
        f = pile.pop()
        if f in vus:
            continue
        vus.add(f)
        assert f in joueurs.FICHIERS, f
        for trouve in re.findall(r'(?:import|export)\s[^;]*?from\s*"(\.[^"]+)"|import\s*"(\.[^"]+)"', (STATIQUE / f).read_text(encoding="utf-8")):
            pile.append(os.path.normpath(os.path.join(os.path.dirname(f), next(x for x in trouve if x))))
    # Rien de la campagne dans ce graphe : ni les fiches de départ, ni la géographie de la saison 4, ni l'atelier.
    assert not [f for f in vus if "kit" in f or "saison4" in f or f.startswith(("js/atelier", "js/mj/", "js/seances/", "js/scenarios/"))]
    # Au coin, l'écran ne lit jamais le serveur ni n'ouvre de liaison : la page lui passe ce qui est publié.
    source = (STATIQUE / "js/table/source-coin.js").read_text(encoding="utf-8")
    assert "poserSource" in source and "ev.origin !== location.origin" in source and "ev.source !== window.parent" in source
    script = (STATIQUE / "js/table.js").read_text(encoding="utf-8")
    assert "if (COIN) brancherCoin(recevoir);" in script and "else ecouter();" in script


def test_seule_la_page_de_l_ecran_se_laisse_encadrer_et_par_le_coin_seul(monde):
    coin = monde["coin"]
    r = coin.get("/table/ecran")
    assert r.status_code == 200 and "text/html" in r.headers["content-type"]
    assert r.headers["x-frame-options"] == "SAMEORIGIN" and "frame-ancestors 'self'" in r.headers["content-security-policy"]
    assert "default-src 'self'" in r.headers["content-security-policy"]
    for chemin in ("/table", "/carnet", "/api/table", "/static/js/table.js", "/table/ecran/", "/table/ecranx"):
        h = coin.get(chemin, follow_redirects=False).headers
        assert h["x-frame-options"] == "DENY" and "frame-ancestors 'none'" in h["content-security-policy"], chemin
    # Sans session : rien.
    assert TestClient(joueurs.app).get("/table/ecran").status_code == 401
    page = (STATIQUE / "joueurs" / "table.html").read_text(encoding="utf-8")
    assert '<iframe class="ecran-coin"' in page
    module = (STATIQUE / "js/joueurs/table-coin.js").read_text(encoding="utf-8")
    assert 'cadre.src = "/table/ecran"' in module and "monterMainLevee();" in module and "monterEtat(page);" in module


def test_table_fermee_il_ne_reste_rien(atelier, monde):
    montrer(atelier, monde, vue="image", url=monde["paysage"], titre="x")
    assert list((TABLE / table_joueurs.MEDIA).iterdir())
    atelier.put("/api/table-joueurs", json={"ouverte": False})
    try:
        assert not TABLE.exists() and monde["coin"].get("/api/table").json() == {"ouverte": False}
    finally:
        atelier.put("/api/table-joueurs", json={"ouverte": True})


# ---------------------------------------------------------------- quand c'est le MJ invité qui a la main sur la TV

def test_l_ecran_publie_ce_que_montre_la_tv_d_un_mj_invite(atelier, monkeypatch):
    """En strict, avec deux MJ : la publication de la table du coin (une tâche de fond) lit ce que montre la TV, que la
    fiche soit au principal ou à l'invité, et la rend comme la TV la lit ; le secret de l'invité ne sort pas davantage."""
    import deux_mj
    from mj import cloisonnement
    monkeypatch.setattr(cloisonnement, "MODE", cloisonnement.STRICT)
    cloisonnement.oublier()
    alban, lea = deux_mj.ouvrir(monkeypatch)
    crees = []

    def pnj(qui, nom, connu, cache):
        f = atelier.post("/api/pnj", json={"nom": nom, "connu": connu, "role": "Passeur", **{"secret": cache}}, headers=qui).json()
        crees.append((f["id"], qui))
        return f

    try:
        assert atelier.put("/api/table-joueurs", json={"ouverte": True}, headers=alban).status_code == 200
        sien = pnj(lea, "Le passeur du bac", True, "SECRET-DU-PASSEUR")
        inconnu = pnj(lea, "Sombrelune", False, "SECRET-SOMBRELUNE")
        autre = pnj(alban, "Ernest Viguier", True, "SECRET-ERNEST")
        for fiche, qui, attendu in ((sien, lea, "Le passeur du bac"), (inconnu, lea, None), (autre, alban, "Ernest Viguier")):
            r = atelier.put("/api/table", json={"vue": "accueil", "pnj": fiche["id"], "reprendre": True}, headers=qui)
            assert r.status_code == 200, r.text
            assert tv_etat.table_coin.tout_de_suite()["ouverte"] is True
            texte = (TABLE / table_joueurs.VUE).read_text(encoding="utf-8")
            ecran = json.loads(texte)["ecran"]
            j = tv_cartes.jeton("pnj", fiche["id"])
            if attendu:
                assert ecran["etat"]["pnj"] == j and ecran["lectures"][f"/api/table/pnj/{j}"]["nom"] == attendu
                # La même chose que ce que lit l'écran de la table (sans compte, sur le réseau local).
                assert sans_medias(ecran["lectures"][f"/api/table/pnj/{j}"]) == sans_medias(atelier.get(f"/api/table/pnj/{j}").json())
            else:
                assert ecran["lectures"] == {} and ecran["etat"]["pnj"] is None and j not in texte
            for interdit in ("SECRET-", "Sombrelune", fiche["id"]):
                assert interdit not in texte, interdit
    finally:
        atelier.put("/api/table", json={"vue": "accueil", "reprendre": True}, headers=alban)
        for ident, qui in crees:
            atelier.delete(f"/api/pnj/{ident}", headers=qui)
        atelier.put("/api/table-joueurs", json={"ouverte": False}, headers=alban)
        deux_mj.fermer()
        cloisonnement.oublier()
