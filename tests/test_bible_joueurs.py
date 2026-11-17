"""La bible des joueurs : l'atelier ne publie dans propositions/bible/ que la liste blanche (chapitres, synthèses et
arbitrages, glossaire, inventaire, fiches d'épisode), passée par le masque du nom caché de l'auberge ; le coin des joueurs
ne sert que les clés de cet index, à un joueur connecté, bible ouverte. Jamais un Contrôle, ni « Mystères et
flottements », ni un fichier de travail : ni en lecture, ni dans la recherche, ni sur le disque du coin."""
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from commun import bible  # noqa: E402
import joueurs  # noqa: E402
from comptes_coin import entrer as entrer_au_coin  # noqa: E402
import main  # noqa: E402
from table import masque  # noqa: E402
from api import application, bible_api, config  # noqa: E402
from commun import campagne  # noqa: E402

# Le dernier groupe de la bible de la campagne (campagne d'exemple ou pack) : celui des fiches hors saison des essais.
DERNIER = campagne.ORDRE_GROUPES_BIBLE[-1]

PUBLIEE = config.PROPOSITIONS / bible.BIBLE
# Les mots-témoins des documents fermés : aucun ne doit atteindre le coin.
TEMOINS = {
    "chronique/controle-2026-09-30.md": "TEMOINCHRONIQUE",
    "kit/controle-heros.md": "TEMOINKIT",
    "examen/s4.md": "TEMOINEXAMEN",
    "bible/mysteres-et-flottements.md": "TEMOINMYSTERE",
    "bible/verifications/coherence.md": "TEMOINVERIF",
    "bible/brouillon.md": "TEMOINBROUILLON",
    "saisons/saison-1-fiches.md": "TEMOINFICHES",
    "saisons/saison-1-noms.md": "TEMOINNOMS",
    "saisons/essai-pilote.md": "TEMOINESSAI",
    "archives/glossaire-base.md": "TEMOINARCHIVE",
    "transcriptions/saison-1/001-jixB1pAJMqY.md": "TEMOINTRANSCRIPTION",
    "episodes/hors-canon/001-abcdefghijk.md": "TEMOINHORSCANON",
}
OUVERTS = {"bible/etat-du-monde.md", "bible/chronologie.md", "bible/ton-et-table.md", "saisons/saison-1.md",
           "saisons/saison-1-arbitrages.md", "glossaire.md", "inventaire.md", "episodes/saison-1/001-jixB1pAJMqY.md",
           f"episodes/{DERNIER}/001-ucc3EIt2E9U.md"}


def ecrire(racine, relatif, texte):
    chemin = racine / relatif
    chemin.parent.mkdir(parents=True, exist_ok=True)
    chemin.write_text(texte, encoding="utf-8")


def texte_publie() -> str:
    return "\n".join(f.read_text(encoding="utf-8") for f in sorted(PUBLIEE.rglob("*")) if f.is_file())


@pytest.fixture(scope="module")
def atelier():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture()
def lore(tmp_path, monkeypatch):
    racine = tmp_path / "lore"
    ecrire(racine, "bible/etat-du-monde.md", "# Le Calvère à la fin de la saison 4\n\n- Édric règne sur Clairefonds.\n"
           "- Voir [les mystères](mysteres-et-flottements.md#titan) et [la chronologie](chronologie.md).\n"
           "- Renvoi fermé [Mystères][m] et renvoi ouvert [Chronologie][c].\n\n"
           "[m]: mysteres-et-flottements.md\n[c]: chronologie.md\n<!-- note de travail TEMOINCOMMENTAIRE -->\n")
    ecrire(racine, "bible/chronologie.md", "# Chronologie du Calvère\n\n- Toma dort à la Petite Fanfrelée, puis "
           "« Jamais ne dort » rouvre.\n- Clairefonds brûle ([S1E1](https://youtu.be/abc?t=30)).\n")
    ecrire(racine, "bible/ton-et-table.md", "# Ton et moments cultes\n\n- La table rit de Clairefonds.\n")
    ecrire(racine, "saisons/saison-1.md", "# Saison 1\n\nLe Grimoire est volé à Clairefonds.\n")
    ecrire(racine, "saisons/saison-1-arbitrages.md", "# Arbitrages\n\nGrimoire : deux versions.\n")
    ecrire(racine, "glossaire.md", "# Glossaire\n\n- Clairefonds : la cité.\n")
    ecrire(racine, "inventaire.md", "# Inventaire\n\n- Clairefonds, épisode 1\n")
    ecrire(racine, "episodes/saison-1/001-jixB1pAJMqY.md", "# Épisode 1 : Clairefonds\n\n- Toma arrive à Clairefonds.\n")
    ecrire(racine, f"episodes/{DERNIER}/001-ucc3EIt2E9U.md", "# Hors-série 1\n\n- Un hors-série à Clairefonds.\n")
    for relatif, temoin in TEMOINS.items():
        ecrire(racine, relatif, f"# Fermé {temoin}\n\n- Clairefonds et {temoin}, le secret du MJ.\n")
    ecrire(racine, "lots/bible-themes.json", '{"temoin": "TEMOINLOTS"}')
    monkeypatch.setattr(bible_api, "LORE", racine)
    yield racine
    bible.fermer(config.PROPOSITIONS)
    bible_api.BIBLE_JOUEURS.unlink(missing_ok=True)


@pytest.fixture()
def coin(monkeypatch):
    monkeypatch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    monkeypatch.setattr(joueurs, "COOKIE_SUR", False)
    monkeypatch.setattr(joueurs, "HOTES", set())
    monkeypatch.setattr(joueurs, "RECHERCHES_BIBLE", bible.Cadence(30, 60))
    with TestClient(joueurs.app) as c:
        yield c


@pytest.fixture()
def connecter(atelier):
    """Invite un joueur et ouvre sa session dans un client du coin ; les invités repartent à la fin du test."""
    invites = []

    def entrer(client, nom="Léa"):
        invite = atelier.post("/api/joueurs", json={"nom": nom}).json()
        invites.append(invite["id"])
        cle = invite["id"]
        # Le provisoire du MJ crée le compte du joueur et ouvre sa session.
        entrer_au_coin(client, cle)
        return client

    yield entrer
    for ident in invites:
        atelier.delete(f"/api/joueurs/{ident}")


def ouvrir(atelier, ouverte=True):
    etat = atelier.put("/api/bible-joueurs", json={"ouverte": ouverte}).json()
    assert etat["ouverte"] is ouverte
    return etat


def test_fermee_par_defaut_rien_n_est_publie(atelier, coin, lore, connecter):
    connecter(coin)
    assert atelier.get("/api/bible-joueurs").json()["ouverte"] is False
    bible_api.tour_de_la_bible({})
    assert not PUBLIEE.exists()
    for url in ("/api/bible", "/api/bible/document?chemin=glossaire.md", "/api/bible/recherche?q=clairefonds"):
        r = coin.get(url)
        assert r.status_code == 423 and "pas ouverte" in r.json()["detail"], url
    # Ouverte puis refermée : il n'en reste rien dans les propositions.
    ouvrir(atelier)
    assert (PUBLIEE / bible.INDEX).is_file() and coin.get("/api/bible").status_code == 200
    assert coin.get("/api/carnet").status_code == 200
    ouvrir(atelier, False)
    assert not PUBLIEE.exists()
    assert coin.get("/api/bible").status_code == 423
    assert coin.get("/api/bible/document", params={"chemin": "glossaire.md"}).status_code == 423


def test_sans_session_401(atelier, coin, lore, connecter):
    ouvrir(atelier)
    for url in ("/api/bible", "/api/bible/document?chemin=glossaire.md", "/api/bible/recherche?q=clairefonds"):
        assert coin.get(url).status_code == 401, url
    assert coin.get("/bible", follow_redirects=False).status_code == 303
    connecter(coin)
    assert coin.get("/bible").status_code == 200 and "bible-coin.js" in coin.get("/bible").text


def test_seule_la_liste_blanche_est_publiee(atelier, coin, lore, connecter):
    connecter(coin)
    etat = ouvrir(atelier)
    assert etat["documents"] == len(OUVERTS) and etat["octets"] > 0
    # Le MJ voit ce qui lui reste : le chapitre retenu et les Contrôles.
    assert {"titre": "Fermé TEMOINMYSTERE", "rubrique": "La bible"} in etat["fermes"]
    assert sum(d["rubrique"] == "Contrôles" for d in etat["fermes"]) == 3
    sommaire = coin.get("/api/bible").json()
    chemins = {d["chemin"] for d in sommaire["documents"]} | {f["chemin"] for g in sommaire["episodes"] for f in g["fiches"]}
    assert chemins == OUVERTS
    assert [g["groupe"] for g in sommaire["episodes"]] == ["saison-1", DERNIER]
    assert all(set(d) == {"chemin", "titre", "rubrique"} for d in sommaire["documents"])
    assert "Contrôles" not in {d["rubrique"] for d in sommaire["documents"]}
    for chemin in OUVERTS:
        assert coin.get("/api/bible/document", params={"chemin": chemin}).status_code == 200, chemin
    # Sur le disque du coin : aucun mot-témoin, aucun chemin de document fermé.
    tout = texte_publie()
    for temoin in [*TEMOINS.values(), "TEMOINLOTS", "TEMOINCOMMENTAIRE"]:
        assert temoin not in tout, temoin
    assert "mysteres-et-flottements" not in tout and "verifications" not in tout


def test_chaque_document_ferme_repond_404(atelier, coin, lore, connecter):
    connecter(coin)
    ouvrir(atelier)
    for chemin, temoin in TEMOINS.items():
        # L'atelier le lit (il existe bien), le coin non.
        if bible.CHEMIN_LORE.match(chemin):
            assert temoin in atelier.get("/api/bible/document", params={"chemin": chemin}).json()["markdown"]
        r = coin.get("/api/bible/document", params={"chemin": chemin})
        assert r.status_code == 404 and temoin not in r.text, chemin
    assert coin.get("/api/bible/document", params={"chemin": "lots/bible-themes.json"}).status_code == 404


def test_chemins_detournes_refuses(atelier, coin, lore, connecter):
    connecter(coin)
    ouvrir(atelier)
    publie = bible.nom_publie("glossaire.md")
    for chemin in ("../secret.md", "bible/../../secret.md", "bible/../examen/s4.md", "bible/./chronologie.md", "/etc/passwd",
                   "/lore/glossaire.md", str(lore / "glossaire.md"), str(lore / "examen/s4.md"), "//glossaire.md",
                   "bible//chronologie.md", "bible\\chronologie.md", "%2e%2e/examen/s4.md", "glossaire.md\x00",
                   "GLOSSAIRE.md", "glossaire", f"docs/{publie}", publie, "index.json", bible.INDEX, "", "x" * 5000):
        r = coin.get("/api/bible/document", params={"chemin": chemin})
        assert r.status_code == 404, chemin
    assert coin.get("/api/bible/document").status_code == 404
    # Le fichier publié n'est pas servi tel quel non plus.
    assert coin.get(f"/static/../propositions/bible/docs/{publie}").status_code == 404
    assert coin.get(f"/carnet/media/{publie}").status_code == 404


def test_la_recherche_ne_rend_jamais_un_document_ferme(atelier, coin, lore, connecter):
    connecter(coin)
    ouvrir(atelier)
    # L'atelier trouve le chapitre retenu ; le coin, jamais.
    assert atelier.get("/api/bible/recherche", params={"q": "TEMOINMYSTERE"}).json()["total"] == 1
    for temoin in [*TEMOINS.values(), "TEMOINLOTS", "TEMOINCOMMENTAIRE"]:
        r = coin.get("/api/bible/recherche", params={"q": temoin}).json()
        assert r == {"resultats": [], "total": 0}, temoin
    r = coin.get("/api/bible/recherche", params={"q": "clairefonds"}).json()
    assert r["resultats"] and {x["chemin"] for x in r["resultats"]} <= OUVERTS
    assert "TEMOIN" not in str(r) and "secret du MJ" not in str(r)
    # Le même ordre que l'atelier : la bible, les synthèses, le glossaire, puis les fiches.
    assert [x["chemin"] for x in r["resultats"]] == ["bible/etat-du-monde.md", "bible/chronologie.md", "bible/ton-et-table.md",
                                                     "saisons/saison-1.md", "glossaire.md", "episodes/saison-1/001-jixB1pAJMqY.md",
                                                     f"episodes/{DERNIER}/001-ucc3EIt2E9U.md"]


def test_un_nom_cache_sort_masque(atelier, coin, lore, connecter):
    ecrire(lore, "bible/lieux.md", "# Les lieux de la Petite Fanfrelée\n\n- La P'tite Fanfrelée, l'auberge de Toma.\n"
           "- F­anfrelée, coupée par un invisible.\n")
    connecter(coin)
    ouvrir(atelier)
    tout = texte_publie().lower()
    assert "anfrel" not in tout and "ne dort" not in tout
    doc = coin.get("/api/bible/document", params={"chemin": "bible/chronologie.md"}).json()
    assert "anfrel" not in doc["markdown"].lower() and "l'auberge" in doc["markdown"]
    lieux = coin.get("/api/bible/document", params={"chemin": "bible/lieux.md"}).json()
    assert "anfrel" not in (lieux["titre"] + lieux["markdown"]).lower()
    sommaire = coin.get("/api/bible").json()
    assert "anfrel" not in str(sommaire).lower()
    assert coin.get("/api/bible/recherche", params={"q": "fanfrelee"}).json()["total"] == 0
    assert "anfrel" not in str(coin.get("/api/bible/recherche", params={"q": "auberge"}).json()).lower()
    # L'atelier, lui, garde le texte du MJ tel quel.
    assert "Fanfrelée" in atelier.get("/api/bible/document", params={"chemin": "bible/chronologie.md"}).json()["markdown"]


def test_un_document_ou_le_nom_resisterait_est_retenu(lore):
    ecrire(lore, "bible/factions.md", "# Factions\n\n- Le nom NOMRESISTANT.\n")
    publie = bible.publier(config.PROPOSITIONS, lore, True, lambda t: t, lambda t: "NOMRESISTANT" in t)
    assert publie["retenus"] == ["Factions"] and "NOMRESISTANT" not in texte_publie()
    assert "bible/factions.md" not in (bible.index_publie(config.PROPOSITIONS) or {})


def test_liens_vers_un_document_ferme_retires(atelier, coin, lore, connecter):
    connecter(coin)
    ouvrir(atelier)
    md = coin.get("/api/bible/document", params={"chemin": "bible/etat-du-monde.md"}).json()["markdown"]
    assert "Voir les mystères et [la chronologie](chronologie.md)." in md
    assert "Renvoi fermé Mystères et renvoi ouvert [Chronologie][c]." in md
    assert "[c]: chronologie.md" in md and "[m]:" not in md
    assert "https://youtu.be/abc?t=30" in coin.get("/api/bible/document", params={"chemin": "bible/chronologie.md"}).text


def test_index_falsifie_ne_sert_pas_un_controle(atelier, coin, lore, connecter):
    """Même un index qui nommerait un Contrôle ne le ferait pas servir : le coin reprend la liste blanche."""
    connecter(coin)
    ouvrir(atelier)
    index = bible.lire_index(config.PROPOSITIONS)
    faux = bible.nom_publie("examen/s4.md")
    (PUBLIEE / bible.DOCS / faux).write_text("# Examen\n\nTEMOINEXAMEN\n", encoding="utf-8")
    elements = index["elements"] + [{"chemin": "examen/s4.md", "titre": "Examen", "rubrique": "La bible", "groupe": "",
                                     "fichier": faux, "source": "x"},
                                    {"chemin": "glossaire.md", "titre": "G", "rubrique": "Références", "groupe": "", "fichier": "../../x.md", "source": "x"}]
    bible.carnet.ecrire_atomique(PUBLIEE / bible.INDEX, {**index, "elements": elements})
    assert coin.get("/api/bible/document", params={"chemin": "examen/s4.md"}).status_code == 404
    assert "examen" not in str(coin.get("/api/bible").json())
    assert coin.get("/api/bible/recherche", params={"q": "TEMOINEXAMEN"}).json()["total"] == 0


def test_republiee_quand_le_lore_change(atelier, coin, lore, connecter):
    connecter(coin)
    ouvrir(atelier)
    assert not bible.a_republier(config.PROPOSITIONS, lore, True, masque.nom_public())
    # Rien n'a bougé : rien n'est réécrit.
    assert bible_api.publier_bible()["ecrits"] == 0
    fiche = lore / "saisons/saison-1.md"
    fiche.write_text("# Saison 1\n\nLe Titan se réveille.\n", encoding="utf-8")
    os.utime(fiche, ns=(fiche.stat().st_atime_ns, fiche.stat().st_mtime_ns + 1_000_000))
    ecrire(lore, "examen/s5.md", "# Examen 5\n\nTEMOINNOUVEAU Titan\n")
    assert bible.a_republier(config.PROPOSITIONS, lore, True, masque.nom_public())
    suivi = {"depuis": __import__("time").monotonic()}
    bible_api.tour_de_la_bible(suivi)
    # Seuls le document changé et l'index sont réécrits.
    assert suivi["dernier"]["ecrits"] == 2
    r = coin.get("/api/bible/recherche", params={"q": "titan"}).json()
    assert [x["chemin"] for x in r["resultats"]] == ["saisons/saison-1.md"]
    assert "TEMOINNOUVEAU" not in texte_publie()
    # Un document retiré de /lore quitte la bible publiée.
    (lore / "inventaire.md").unlink()
    bible_api.tour_de_la_bible(suivi)
    assert coin.get("/api/bible/document", params={"chemin": "inventaire.md"}).status_code == 404
    assert len(list((PUBLIEE / bible.DOCS).iterdir())) == len(OUVERTS) - 1


def test_recherche_limitee_par_joueur(atelier, coin, lore, connecter):
    connecter(coin)
    ouvrir(atelier)
    for _ in range(30):
        assert coin.get("/api/bible/recherche", params={"q": "grimoire"}).status_code == 200
    r = coin.get("/api/bible/recherche", params={"q": "grimoire"})
    assert r.status_code == 429
    # La lecture reste libre, et un autre joueur cherche encore.
    assert coin.get("/api/bible/document", params={"chemin": "glossaire.md"}).status_code == 200
    with TestClient(joueurs.app) as autre:
        connecter(autre, "Noé")
        assert autre.get("/api/bible/recherche", params={"q": "grimoire"}).status_code == 200


def test_cadence_oublie_les_vieux_passages():
    c = bible.Cadence(2, 60)
    assert c.accepter("a", 0) and c.accepter("a", 1) and not c.accepter("a", 2)
    assert c.accepter("a", 61) and c.accepter("b", 61)
    assert c.accepter("b", 200) and "a" not in c.passages


def test_seuls_les_modules_de_la_bible_entrent_dans_le_coin(coin):
    for chemin in ("js/bible/bible.js", "js/joueurs/bible-coin.js", "css/bible-coin.css"):
        assert coin.get(f"/static/{chemin}").status_code == 200, chemin
    # L'interrupteur du MJ reste dans l'atelier.
    assert coin.get("/static/js/bible/joueurs-mj.js").status_code == 404
    assert "js/bible/joueurs-mj.js" not in joueurs.FICHIERS


def test_liste_blanche():
    for chemin in OUVERTS | {"bible/personnages.md", "saisons/saison-2-arbitrages.md", "episodes/saison-2/001-ms_ZcfSvcJA.md"}:
        assert bible.ouvert_aux_joueurs(chemin), chemin
    for chemin in [*TEMOINS, "bible/mysteres-et-flottements.md", "kit/corrections-heros.md", "saisons/hors-serie-noms.md",
                   "episodes/saison-1/../../examen/s4.md", "episodes/saison-1/x.md", "bible/verifications/lieux.md", None, 3]:
        assert not bible.ouvert_aux_joueurs(chemin), chemin


def test_voir_comme_renvoie_a_l_onglet_bible(atelier, lore, connecter):
    """Le menu du coin ouvre « /bible » ; « Voir comme » (une page de l'atelier) n'a pas ce chemin (404 dans l'atelier) :
    sa barre renvoie à l'onglet Bible de l'atelier."""
    ouvrir(atelier)
    invite = atelier.post("/api/joueurs", json={"nom": "Apercu"}).json()
    try:
        assert atelier.get(f"/api/joueurs/{invite['id']}/apercu").json()["carnet"]["bible"] is True
    finally:
        atelier.delete(f"/api/joueurs/{invite['id']}")
    assert atelier.get("/bible").status_code == 404
    statique = Path(main.__file__).resolve().parent / "static" / "js" / "joueurs"
    assert '["/bible", "La bible"' in (statique / "menu-coin.js").read_text(encoding="utf-8")
    assert '<a href="/#/bible">Bible</a>' in (statique.parent.parent / "joueurs" / "apercu.html").read_text(encoding="utf-8")
