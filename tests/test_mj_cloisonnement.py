"""Le cloisonnement côté serveur (cloisonnement.py, lot MJ-3) : le lecteur de chaque requête, le filtre au plus bas,
l'union réservée aux projections publiques (un test sur l'AST), la règle des routes pour l'invité dans la Garde, les
statiques de l'invité, les identifiants opaques, les messages qui anonymisent, la veille et le strict."""

import ast
import json
import os
import re
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from mj import acces_mj  # noqa: E402
from mj import cloisonnement  # noqa: E402
from mj import comptes_mj  # noqa: E402
import deux_mj  # noqa: E402
import main  # noqa: E402
from table import horloges  # noqa: E402
from api import application, carnet_api, config, portier, tv_boutique_combat, tv_cartes, tv_ecran, tv_etat, tv_fiches, utilitaires  # noqa: E402
from table import masque  # noqa: E402
from mj import proprietes  # noqa: E402

APP = Path(__file__).resolve().parent.parent / "app"
RACINE = APP.parent


@pytest.fixture(scope="module")
def appli():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture
def strict(monkeypatch):
    monkeypatch.setattr(cloisonnement, "MODE", cloisonnement.STRICT)
    cloisonnement.oublier()
    yield
    cloisonnement.oublier()


@pytest.fixture
def veille(monkeypatch):
    monkeypatch.setattr(cloisonnement, "MODE", cloisonnement.VEILLE)
    cloisonnement.oublier()
    yield
    cloisonnement.oublier()


@pytest.fixture
def deux(appli, monkeypatch):
    alban, lea = deux_mj.ouvrir(monkeypatch)
    yield appli, alban, lea
    deux_mj.fermer()


def lecteur(l):
    """Le temps d'un bloc, un autre lecteur que celui des essais (la tâche de fond)."""
    class Bloc:
        def __enter__(self):
            self.jeton = cloisonnement.poser_lecteur(l)

        def __exit__(self, *a):
            cloisonnement.retirer_lecteur(self.jeton)
    return Bloc()


# ---------------------------------------------------------------- l'union, réservée aux projections publiques

def qualifie(module: str, pile: list) -> str:
    return ".".join([module, *pile])


# La tuyauterie du filtre : lire_tout() et existant() passent leur « tout » au filtre, cloisonnement.py le reçoit.
PLOMBERIE = ("utilitaires.lire_tout", "utilitaires.existant", "cloisonnement.")


def appels_de_l_union() -> list:
    """(fonction qualifiée, ligne) de chaque appel qui demande ou peut demander l'union : tout=… autre que False, ou
    « tout » passé en position à lire_tout(), existant() ou aux filtres de cloisonnement.py. La tuyauterie mise à part."""
    positions = {"lire_tout": 1, "existant": 2}
    filtres = {"garder": 2, "permis": 2, "permis_chemin": 2, "permis_auteur": 2}
    trouves = []
    for f in sorted(APP.rglob("*.py")):
        arbre = ast.parse(f.read_text(encoding="utf-8"))

        def visiter(noeud, pile):
            for enfant in ast.iter_child_nodes(noeud):
                if isinstance(enfant, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    visiter(enfant, pile + [enfant.name])
                    continue
                if isinstance(enfant, ast.Call):
                    qui = qualifie(f.stem, pile)
                    fonction = enfant.func
                    nom = fonction.id if isinstance(fonction, ast.Name) else getattr(fonction, "attr", None)
                    du_filtre = (isinstance(fonction, ast.Attribute) and isinstance(fonction.value, ast.Name)
                                 and fonction.value.id == "cloisonnement" and nom in filtres)
                    union = any(kw.arg == "tout" and not (isinstance(kw.value, ast.Constant) and kw.value.value is False)
                                for kw in enfant.keywords)
                    union |= nom in positions and len(enfant.args) > positions[nom]
                    union |= du_filtre and len(enfant.args) > filtres[nom]
                    if union and not qui.startswith(PLOMBERIE):
                        trouves.append((qui, enfant.lineno))
                visiter(enfant, pile)
        visiter(arbre, [])
    return trouves


def test_l_union_seulement_dans_les_projections_publiques():
    autorisees = set(cloisonnement.PROJECTIONS_PUBLIQUES)
    hors = []
    for qui, ligne in appels_de_l_union():
        morceaux = qui.split(".")
        # Une fonction imbriquée dans une projection publique en fait partie.
        if not any(".".join(morceaux[:i]) in autorisees for i in range(2, len(morceaux) + 1)):
            hors.append(f"{qui} (ligne {ligne})")
    assert hors == [], ("tout=True (l'union des MJ) hors d'une projection publique : " + ", ".join(hors)
                        + ". Lire les fiches du lecteur, ou ranger la fonction dans cloisonnement.PROJECTIONS_PUBLIQUES "
                          "si elle ne sert vraiment que ce que voient la TV, la table publique ou les joueurs.")


def test_chaque_projection_publique_sert_encore():
    utilisees = {qui for qui, _ in appels_de_l_union()}
    perimees = sorted(p for p in cloisonnement.PROJECTIONS_PUBLIQUES if not any(u == p or u.startswith(p + ".") for u in utilisees))
    assert perimees == [], f"Projections publiques sans union : {perimees}"


# ---------------------------------------------------------------- « Partager avec l'autre MJ » : lecture=True

ECRITURES = {"ecrire", "jeter", "archiver", "ecrire_json", "ecrire_json_compact", "ecrire_texte", "ecrire_octets", "unlink", "replace"}


def appels_de_la_lecture_partagee() -> dict:
    """{fonction qualifiée : les noms qu'elle appelle} pour chaque fonction qui demande lecture=… autre que False (la
    tuyauterie de lire_tout(), existant() et cloisonnement.py mise à part)."""
    trouves: dict = {}
    for f in sorted(APP.rglob("*.py")):
        arbre = ast.parse(f.read_text(encoding="utf-8"))

        def visiter(noeud, pile):
            for enfant in ast.iter_child_nodes(noeud):
                if isinstance(enfant, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    visiter(enfant, pile + [enfant.name])
                    continue
                if isinstance(enfant, ast.Call):
                    qui = qualifie(f.stem, pile)
                    if any(kw.arg == "lecture" and not (isinstance(kw.value, ast.Constant) and kw.value.value is False)
                           for kw in enfant.keywords) and not qui.startswith(PLOMBERIE):
                        porteuse = next(n for n in ast.walk(arbre) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                                        and n.name == pile[-1] and enfant in list(ast.walk(n)))
                        trouves[qui] = {x.func.id if isinstance(x.func, ast.Name) else getattr(x.func, "attr", "")
                                        for x in ast.walk(porteuse) if isinstance(x, ast.Call)}
                visiter(enfant, pile)
        visiter(arbre, [])
    return trouves


def test_la_lecture_partagee_seulement_dans_les_lectures_relues():
    """lecture=True ouvre à l'autre MJ la fiche qu'on lui partage : seulement dans les fonctions rangées, et aucune d'elles
    n'écrit de fiche. Toute écriture garde existant() sans ce mot : la fiche partagée y répond 403."""
    trouves = appels_de_la_lecture_partagee()
    assert set(trouves) == set(cloisonnement.LECTURES_PARTAGEES), (
        "lecture=True hors de cloisonnement.LECTURES_PARTAGEES, ou une entrée qui ne sert plus : "
        f"{sorted(set(trouves) ^ set(cloisonnement.LECTURES_PARTAGEES))}")
    for qui, appels in trouves.items():
        assert not appels & ECRITURES, f"{qui} lit une fiche partagée et écrit : {sorted(appels & ECRITURES)}"
    # Aucun appel ne passe « lecture » en position.
    assert set(proprietes.PARTAGEABLES) <= set(proprietes.COLLECTIONS)
    assert not set(proprietes.PARTAGEABLES) & {"scenarios", "seances", "fils", "idees"}


@pytest.mark.parametrize("mode", [cloisonnement.VEILLE, cloisonnement.STRICT])
def test_le_filtre_et_le_partage(monkeypatch, mode, tmp_path):
    monkeypatch.setattr(cloisonnement, "MODE", mode)
    cloisonnement.oublier()
    fiches = [{"id": "a", "partage": True}, {"id": "b", "auteur": "alban"}, {"id": "c", "auteur": "lea", "partage": True},
              {"id": "d", "auteur": "lea", "partage": "oui"}]

    def ids(liste):
        return [f["id"] for f in liste]
    with lecteur("lea"):
        # Lire : les siennes et celle qu'Alban partage ; sans le mot « lecture », seulement les siennes.
        assert ids(cloisonnement.garder("pnj", fiches, lecture=True)) == (["a", "c", "d"] if mode == "strict" else ["a", "b", "c", "d"])
        assert ids(cloisonnement.garder("pnj", fiches)) == (["c", "d"] if mode == "strict" else ["a", "b", "c", "d"])
        assert cloisonnement.permis("lieux", fiches[0], lecture=True)
        # Une collection qui ne se partage pas ignore le champ.
        assert ids(cloisonnement.garder("scenarios", fiches, lecture=True)) == (["c", "d"] if mode == "strict" else ["a", "b", "c", "d"])
    with lecteur("alban"):
        # « partage » n'est vrai que s'il est le booléen vrai.
        assert ids(cloisonnement.garder("pnj", fiches, lecture=True)) == (["a", "b", "c"] if mode == "strict" else ["a", "b", "c", "d"])
    # Ni la TV ni la table publique : le partage ne vaut qu'entre comptes MJ.
    with lecteur(cloisonnement.PUBLIC):
        assert ids(cloisonnement.garder("pnj", fiches, lecture=True)) == ([] if mode == "strict" else ["a", "b", "c", "d"])
    # Par le chemin (existant) : la fiche partagée se lit, ne s'écrit pas ; le cache suit le fichier.
    chemin = tmp_path / "pnj" / "x.json"
    chemin.parent.mkdir()
    chemin.write_text(json.dumps({"id": "x", "partage": True}), encoding="utf-8")
    cloisonnement.oublier()
    with lecteur("lea"):
        assert cloisonnement.permis_chemin("pnj", chemin, lecture=True) and cloisonnement.vues() == []
        assert cloisonnement.partagee_par_un_autre("pnj", chemin)
        assert cloisonnement.permis_chemin("pnj", chemin) is (mode == "veille")
        chemin.write_text(json.dumps({"id": "x", "partage": False, "nom": "plus long"}), encoding="utf-8")
        assert cloisonnement.permis_chemin("pnj", chemin, lecture=True) is (mode == "veille")
        assert not cloisonnement.partagee_par_un_autre("pnj", chemin)
    with lecteur("alban"):
        assert not cloisonnement.partagee_par_un_autre("pnj", chemin)
    cloisonnement.oublier()


def test_un_secret_partage_se_nomme(strict):
    partage = {"genre": "pnj", "nom": "Octave le passeur", "ids": ["i-0022"], "auteur": "lea", "partage": True}
    d_alban = {"genre": "lieu", "nom": "La combe", "ids": ["la-combe"], "partage": True}
    with lecteur("alban"):
        assert cloisonnement.secrets_vus([partage, d_alban]) == [
            {"genre": "pnj", "nom": "Octave le passeur", "ids": ["i-0022"], "partage": True}, {"genre": "lieu", "nom": "La combe", "ids": ["la-combe"]}]
    with lecteur("lea"):
        assert cloisonnement.secrets_vus([partage, d_alban]) == [
            {"genre": "pnj", "nom": "Octave le passeur", "ids": ["i-0022"]}, {"genre": "lieu", "nom": "La combe", "ids": ["la-combe"], "partage": True}]
    # Un peuple caché n'est jamais « partagé » : un secret de héros reste au principal.
    with lecteur("lea"):
        assert cloisonnement.secret_vu({"genre": "peuple", "nom": "Demi-élémentaire", "ids": ["n"], "partage": True})["nom"] == cloisonnement.SECRET_DE_HEROS


# Les fonctions de main.py qui nomment une collection à auteur hors de lire_tout(), existant() et consorts : chacune relue
# pour le lot MJ-3. Une nouvelle lecture directe d'un dossier de fiches échappe au filtre : ce test la fait relire.
LECTURES_DIRECTES = {
    "boutique_publique": "le marchand d'une boutique montrée à la TV, s'il est connu des joueurs (projection)",
    "creer_carte": "écrit la carte qu'il vient de créer",
    "etat_public": "dates des dossiers pour la version de la TV, rien n'est lu",
    "fiche_du_pion": "choisit le dossier, puis existant(…, tout=True) (projection)",
    "lot_au_lecteur": "permis_chemin sur le scénario du lot",
    "noter_a_la_seance": "écrit dans la séance trouvée par seances_de_la_campagne",
    "plan_tenu_au_lecteur": "permis_chemin sur le plan",
    "seance_existe": "une règle maison (écrite par le principal seul) qui cite une séance",
    "sources_des_jets": "dates des fichiers, rien n'est lu",
    "sources_du_carnet": "dates des fichiers, rien n'est lu",
    "regle_vue": "permis_chemin sur la séance d'une règle",
}
CONSTANTES = {"CARTES", "LIEUX", "PNJ", "CONTRATS", "RUMEURS", "FILS", "SEANCES", "RENCONTRES", "PLANS", "IDEES", "SCENARIOS",
              "BOUTIQUES", "DOCUMENTS"}
FILTREES = {"lire_tout", "existant", "fiche_ou_rien", "par_jeton", "nouvel_id", "routes_fiches", "creer_fiche", "fichier"}


def references_directes() -> dict:
    """{fonction de premier niveau de main.py : les constantes de collections à auteur qu'elle nomme hors du premier
    argument de lire_tout(), existant() et consorts}."""
    trouves: dict = {}

    def nom(f):
        return f.id if isinstance(f, ast.Name) else getattr(f, "attr", None)

    def visiter(noeud, pile):
        sauf = None
        if isinstance(noeud, ast.Call) and nom(noeud.func) in FILTREES and noeud.args and isinstance(noeud.args[0], ast.Name):
            sauf = noeud.args[0]
        for enfant in ast.iter_child_nodes(noeud):
            if enfant is sauf:
                continue
            if isinstance(enfant, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                visiter(enfant, pile + [enfant.name])
                continue
            if isinstance(enfant, ast.Name) and enfant.id in CONSTANTES and pile:
                trouves.setdefault(pile[0], set()).add(enfant.id)
            visiter(enfant, pile)
    for f in sorted((APP / "api").glob("*.py")):
        visiter(ast.parse(f.read_text(encoding="utf-8")), [])
    return trouves


def test_les_lectures_directes_sont_relues():
    nouvelles = sorted(set(references_directes()) - set(LECTURES_DIRECTES))
    assert nouvelles == [], (f"Ces fonctions de main.py lisent un dossier de fiches à auteur sans lire_tout() ni existant() : "
                             f"{nouvelles}. Filtrer (cloisonnement.permis_chemin, fiche_ou_rien) puis les ranger ici.")


# ---------------------------------------------------------------- le lecteur et le filtre

def test_les_lecteurs():
    assert cloisonnement.est_compte("alban") and cloisonnement.est_compte("lea")
    assert not cloisonnement.est_compte(cloisonnement.PUBLIC) and not cloisonnement.est_compte(cloisonnement.FOND)
    assert not cloisonnement.est_compte(None) and not cloisonnement.est_compte("")
    assert cloisonnement.est_invite("lea") and not cloisonnement.est_invite("alban")
    assert not cloisonnement.est_invite(cloisonnement.PUBLIC)
    # Aucun identifiant de compte ne peut se confondre avec un lecteur du serveur.
    assert not comptes_mj.ID_COMPTE.fullmatch(cloisonnement.PUBLIC) and not comptes_mj.ID_COMPTE.fullmatch(cloisonnement.FOND)
    with lecteur("lea"):
        assert cloisonnement.destinataire() == "lea"
    with lecteur(cloisonnement.FOND):
        assert cloisonnement.destinataire() == proprietes.PRINCIPAL


@pytest.mark.parametrize("mode", [cloisonnement.VEILLE, cloisonnement.STRICT])
def test_le_filtre_selon_le_lecteur(monkeypatch, mode):
    monkeypatch.setattr(cloisonnement, "MODE", mode)
    cloisonnement.oublier()
    fiches = [{"id": "a"}, {"id": "b", "auteur": "alban"}, {"id": "c", "auteur": "lea"}]
    tous = ["a", "b", "c"]

    def ids(liste):
        return [f["id"] for f in liste]
    # Une collection sans auteur, l'union, une tâche de fond : tout, sans rien noter.
    with lecteur("lea"):
        assert ids(cloisonnement.garder("aventuriers", fiches)) == tous
        assert ids(cloisonnement.garder("pnj", fiches, tout=True)) == tous
    with lecteur(cloisonnement.FOND):
        assert ids(cloisonnement.garder("pnj", fiches)) == tous
    assert cloisonnement.vues() == []
    # Chacun les siennes ; une fiche sans auteur est au principal. En veille, rien ne change mais c'est noté.
    with lecteur("alban"):
        assert ids(cloisonnement.garder("pnj", fiches)) == (["a", "b"] if mode == "strict" else tous)
    with lecteur("lea"):
        assert ids(cloisonnement.garder("pnj", fiches)) == (["c"] if mode == "strict" else tous)
        assert cloisonnement.permis("plans", {"auteur": "lea"}) and cloisonnement.permis("plans", {}) is (mode == "veille")
    # La TV hors d'une projection publique : rien en strict.
    with lecteur(cloisonnement.PUBLIC):
        assert ids(cloisonnement.garder("seances", fiches)) == ([] if mode == "strict" else tous)
    genres = {v[0] for v in cloisonnement.vues()}
    assert genres == {"fiche-d-un-autre", "public-hors-projection"}
    # Le journal ne nomme ni fiche ni identifiant : genre, route, collection, lecteur.
    assert all(len(v) == 4 and "c" not in v[1:2] for v in cloisonnement.vues())
    cloisonnement.oublier()


def test_un_lecteur_absent(monkeypatch):
    cloisonnement.oublier()
    with lecteur(None):
        monkeypatch.setattr(cloisonnement, "MODE", cloisonnement.VEILLE)
        assert cloisonnement.garder("pnj", [{"id": "x", "auteur": "lea"}]) == [{"id": "x", "auteur": "lea"}]
        assert ("lecteur-absent", "", "", "absent") in cloisonnement.vues()
        monkeypatch.setattr(cloisonnement, "MODE", cloisonnement.STRICT)
        with pytest.raises(cloisonnement.LecteurAbsent):
            cloisonnement.garder("pnj", [{"id": "x"}])
        # L'union et les collections sans auteur ne demandent pas de lecteur.
        assert cloisonnement.garder("pnj", [{"id": "x"}], tout=True) == [{"id": "x"}]
        assert cloisonnement.garder("aventuriers", [{"id": "x"}]) == [{"id": "x"}]
    cloisonnement.oublier()


def test_le_journal_de_veille(tmp_path, monkeypatch):
    monkeypatch.setattr(cloisonnement, "MODE", cloisonnement.VEILLE)
    monkeypatch.setattr(cloisonnement, "_JOURNAL", tmp_path / "mj" / "cloisonnement.jsonl")
    cloisonnement.oublier()
    with lecteur("lea"):
        for _ in range(5):
            cloisonnement.garder("pnj", [{"id": "le-baron-secret", "nom": "Le baron secret"}])
    lignes = [json.loads(x) for x in (tmp_path / "mj" / "cloisonnement.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(lignes) == 1 and lignes[0]["genre"] == "fiche-d-un-autre" and lignes[0]["lecteur"] == "lea"
    assert "baron" not in json.dumps(lignes)
    assert oct((tmp_path / "mj" / "cloisonnement.jsonl").stat().st_mode & 0o777) == "0o600"
    cloisonnement.oublier()


def test_le_mode_par_defaut_et_le_reglage():
    assert cloisonnement.MODE in cloisonnement.MODES
    # Les deux réglages passent par le compose (valeurs dans .env) : veille et invitations fermées par défaut.
    compose = (RACINE / "docker-compose.yml").read_text(encoding="utf-8")
    assert re.search(r"^\s*-\s*ATELIER_CLOISONNEMENT=\$\{ATELIER_CLOISONNEMENT:-veille\}\s*$", compose, re.M)
    assert re.search(r"^\s*-\s*ATELIER_INVITATIONS=\$\{ATELIER_INVITATIONS:-\}\s*$", compose, re.M)
    # Les invitations ne servent qu'avec le strict : jamais un invité dans un atelier seulement en veille.
    if not cloisonnement.strict():
        assert not comptes_mj.invites_permis() or comptes_mj.ESSAI_INVITE_EN_VEILLE
    exemple = (RACINE / ".env.example").read_text(encoding="utf-8")
    assert "ATELIER_CLOISONNEMENT=strict" in exemple and "ATELIER_INVITATIONS=ouvertes" in exemple


# ---------------------------------------------------------------- les secrets nommés

def test_les_secrets_de_l_autre_s_anonymisent(strict):
    a_lea = {"genre": "pnj", "nom": "Morgane la Grise", "ids": ["i-0011"], "auteur": "lea", "precision": "sorcière"}
    a_alban = {"genre": "lieu", "nom": "La crypte du baron", "ids": ["crypte-du-baron"]}
    peuple = {"genre": "peuple", "nom": "Demi-élémentaire du feu", "ids": ["naima"], "de": ["Naïma"]}
    with lecteur("alban"):
        vus = cloisonnement.secrets_vus([a_lea, a_alban, peuple])
        assert vus[0] == {"genre": "pnj", "nom": cloisonnement.AUTRE_MJ, "ids": [], "autre": True}
        assert vus[1] == a_alban and vus[2] == peuple
        assert "Morgane" not in carnet_api.noms_secrets([a_lea, a_alban]) and "La crypte du baron" in carnet_api.noms_secrets([a_lea, a_alban])
    with lecteur("lea"):
        vus = cloisonnement.secrets_vus([a_lea, a_alban, peuple])
        assert vus[0] == {k: v for k, v in a_lea.items() if k != "auteur"}
        assert "crypte" not in json.dumps(vus, ensure_ascii=False) and "Naïma" not in json.dumps(vus, ensure_ascii=False)
        assert vus[2]["nom"] == cloisonnement.SECRET_DE_HEROS and vus[2]["ids"] == []
        message = carnet_api.noms_secrets([a_alban, peuple])
        assert "crypte" not in message and "feu" not in message and "Naïma" not in message
    # Une tâche de fond parle à Alban (le carnet, Telegram).
    with lecteur(cloisonnement.FOND):
        assert "Morgane" not in carnet_api.noms_secrets([a_lea])


def test_en_veille_les_secrets_ne_changent_pas(veille):
    a_lea = {"genre": "pnj", "nom": "Morgane la Grise", "ids": ["i-0011"], "auteur": "lea"}
    with lecteur("alban"):
        assert cloisonnement.secrets_vus([a_lea]) == [{k: v for k, v in a_lea.items() if k != "auteur"}]
    assert {v[0] for v in cloisonnement.vues()} == {"secret-d-un-autre"}


# ---------------------------------------------------------------- les identifiants opaques

def test_l_invite_recoit_des_identifiants_opaques(appli):
    jeton = proprietes.poser_compte("lea")
    try:
        ident = utilitaires.nouvel_id(config.PNJ, "Gaspard Tourbe")
        assert re.fullmatch(r"i-[0-9a-f]{12}", ident)
        # Une collection sans auteur (la tablée, au principal seul) garde ses identifiants de toujours.
        assert utilitaires.nouvel_id(config.AVENTURIERS, "Gaspard") == "gaspard"
    finally:
        proprietes.retirer_compte(jeton)
    assert utilitaires.nouvel_id(config.PNJ, "Gaspard Tourbe") == "gaspard-tourbe"


# ---------------------------------------------------------------- la Garde

def test_la_garde_pose_le_lecteur(appli, monkeypatch):
    vus = []
    origine = portier.lecteur_de_la_requete

    def espion(scope, methode, public):
        r = origine(scope, methode, public)
        vus.append((scope["path"], cloisonnement.lecteur()))
        return r
    monkeypatch.setattr(portier, "lecteur_de_la_requete", espion)
    appli.get("/api/moi")
    appli.get("/api/table/planche")
    appli.get("/table")
    assert vus == [("/api/moi", "alban"), ("/api/table/planche", cloisonnement.PUBLIC), ("/table", cloisonnement.PUBLIC)]


def test_la_regle_de_l_invite_en_strict(deux, strict):
    client, alban, lea = deux
    # Au principal seul, ou non rangée : 404 pour l'invité, comme une route qui n'existe pas.
    for adresse in ("/api/joueurs", "/api/nom-auberge", "/api/mj/comptes", "/api/carnet-joueurs",
                    "/api/demandes/reglages"):
        assert client.get(adresse, headers=lea).status_code == 404, adresse
        assert client.get(adresse, headers=alban).status_code == 200, adresse
    assert client.post("/api/aventuriers", json={"nom": "X"}, headers=lea).status_code == 404
    assert client.put("/api/nom-auberge", json={"nom": "X"}, headers=lea).status_code == 404
    # Commune, à soi, projection : ouvertes.
    for adresse in ("/api/moi", "/api/musique", "/api/pnj", "/api/aventuriers", "/api/monde", "/api/bible", "/api/table"):
        assert client.get(adresse, headers=lea).status_code == 200, adresse
    assert client.get("/api/moi", headers=lea).json()["compte"] == "lea"


def test_les_statiques_de_l_invite(deux, strict):
    client, alban, lea = deux
    # Ce qui porte les secrets du kit : au principal seul ; les modules de son atelier (atelier.js), à l'invité.
    for chemin in ("/static/js/pnj/kit.js", "/static/js/auberge/kit.js", "/static/js/aventuriers/kit.js", "/static/js/carte/editeur.js",
                   "/static/js/campagne/pnj.js", "/static/js/campagne/auberge.js",
                   "/static/index.html",
                   "/static/js/campagne/pretires.js"):
        assert client.get(chemin, headers=lea).status_code == 404, chemin
        assert client.get(chemin, headers=alban).status_code == 200, chemin
    for chemin in ("/static/css/table.css", "/static/js/atelier.js", "/static/js/mj/monde.js", "/static/fonts/Cinzel-VF.woff2"):
        assert client.get(chemin, headers=lea).status_code == 200, chemin


def test_aucun_statique_de_l_invite_ne_porte_un_secret_du_kit():
    statique = APP / "static"
    servis = [f for f in statique.rglob("*") if f.is_file()
              and acces_mj.statique_de_l_invite("/static/" + f.relative_to(statique).as_posix())]
    assert servis
    for f in servis:
        if f.suffix in (".js", ".css", ".html", ".json", ".svg", ".txt"):
            assert not masque.contient_nom_cache(f.read_text(encoding="utf-8", errors="replace")), f
    # Les fichiers qui portent les fiches de départ du kit et ses secrets n'en sont pas.
    for chemin in ("js/pnj/kit.js", "js/auberge/kit.js", "js/aventuriers/kit.js", "js/carte/saison4.js", "js/carte/generateur.js",
                   "js/carte/editeur.js", "js/campagne/carte.js", "js/campagne/pays.js",
                   "js/campagne/pnj.js", "js/campagne/auberge.js",
                   "js/campagne/pretires.js"):
        assert not acces_mj.statique_de_l_invite(f"/static/{chemin}")


def test_en_veille_la_garde_note_et_laisse_passer(deux, veille):
    client, alban, lea = deux
    assert client.get("/api/joueurs", headers=lea).status_code == 200
    assert client.get("/static/js/pnj/kit.js", headers=lea).status_code == 200
    genres = {v[0] for v in cloisonnement.vues()}
    assert {"route-fermee", "statique-fermee"} <= genres
    # Rien de la Garde pour Alban (les fiches d'un autre auteur que d'autres essais ont laissées se notent, elles).
    cloisonnement.oublier()
    client.get("/api/joueurs", headers=alban)
    client.get("/api/pnj", headers=alban)
    assert {v[0] for v in cloisonnement.vues()} <= {"fiche-d-un-autre"}


def test_la_table_de_la_tv_pour_l_invite(deux, strict):
    """L'invité lit la tablée telle que la TV la voit : seulement ce qu'elle montre en ce moment, sous des jetons."""
    client, alban, lea = deux
    p = client.post("/api/pnj", json={"nom": "Ernest Viguier", "connu": True, "secret": "SECRET-ERNEST"}, headers=alban).json()
    j = tv_cartes.jeton("pnj", p["id"])
    assert client.get(f"/api/table/pnj/{j}", headers=alban).status_code == 200
    assert client.get(f"/api/table/pnj/{j}", headers=lea).status_code == 404
    client.put("/api/table", json={"vue": "carte", "pnj": p["id"]}, headers=alban)
    assert client.get(f"/api/table/pnj/{j}", headers=lea).status_code == 200
    table = client.get("/api/table", headers=lea).json()
    assert table["pnj"] == j and p["id"] not in json.dumps(table)
    assert client.get("/api/table", headers=alban).json()["pnj"] == p["id"]
    # Renvoyer la table telle qu'il l'a lue garde ce que la TV montre ; une fiche de l'autre MJ, jamais.
    assert client.put("/api/table", json={**{k: v for k, v in table.items() if k in tv_boutique_combat.CLES_TABLE or k in tv_boutique_combat.REFS_TABLE}},
                      headers=lea).status_code == 200
    assert tv_ecran.etat_table()["pnj"] == p["id"]
    assert client.put("/api/table", json={"vue": "carte", "pnj": p["id"]}, headers=lea).status_code == 404
    mien = client.post("/api/pnj", json={"nom": "Le passeur", "connu": True}, headers=lea).json()
    # Alban a la main sur la TV : Léa la reprend (la question « La reprendre ? », lot MJ-4, test_mj_communs.py).
    assert client.put("/api/table", json={"vue": "carte", "pnj": mien["id"]}, headers=lea).status_code == 409
    assert client.put("/api/table", json={"vue": "carte", "pnj": mien["id"], "reprendre": True}, headers=lea).status_code == 200
    # Symétrique : chacun lit sa fiche en clair, celle de l'autre sous son jeton.
    assert client.get("/api/table", headers=lea).json()["pnj"] == mien["id"]
    assert client.get("/api/table", headers=alban).json()["pnj"] == tv_cartes.jeton("pnj", mien["id"])
    # Alban qui renvoie la table telle qu'il l'a lue garde ce que la TV montre.
    assert client.put("/api/table", json={"vue": "carte", "pnj": tv_cartes.jeton("pnj", mien["id"])}, headers=alban).status_code == 200
    assert tv_ecran.etat_table()["pnj"] == mien["id"]
    assert client.put("/api/table", json={"vue": "accueil", "reprendre": True}, headers=alban).status_code == 200
    for ident in (p["id"], mien["id"]):
        (config.PNJ / f"{ident}.json").unlink(missing_ok=True)


def test_la_tv_ne_dit_pas_si_une_fiche_d_alban_existe(deux, strict):
    """Envoyer à la TV un identifiant deviné (ceux d'Alban suivent les noms) : même réponse que la fiche existe chez lui ou
    n'existe pas. Alban, lui, envoie toujours une fiche absente comme avant."""
    client, alban, lea = deux
    p = client.post("/api/pnj", json={"nom": "Baron Ostrogoth", "connu": False}, headers=alban).json()
    try:
        assert client.put("/api/table", json={"vue": "accueil", "reprendre": True}, headers=lea).status_code == 200
        existe = client.put("/api/table", json={"vue": "accueil", "pnj": p["id"]}, headers=lea)
        absente = client.put("/api/table", json={"vue": "accueil", "pnj": "baron-de-nulle-part"}, headers=lea)
        assert (existe.status_code, existe.json()) == (absente.status_code, absente.json()) == (404, {"detail": "Introuvable"})
        # Ce que montre déjà la TV se renvoie tel quel (une fiche de Léa jetée entre-temps, une page restée ouverte).
        mien = client.post("/api/pnj", json={"nom": "Le passeur", "connu": True}, headers=lea).json()
        assert client.put("/api/table", json={"vue": "accueil", "pnj": mien["id"]}, headers=lea).status_code == 200
        (config.PNJ / f"{mien['id']}.json").unlink()
        assert client.put("/api/table", json={"vue": "accueil", "pnj": mien["id"], "camera": {"z": 2}}, headers=lea).status_code == 200
        assert client.put("/api/table", json={"vue": "accueil", "pnj": "baron-de-nulle-part", "reprendre": True}, headers=alban).status_code == 200
    finally:
        (config.PNJ / f"{p['id']}.json").unlink(missing_ok=True)
        utilitaires.ecrire(config.TABLE, {"vue": "accueil"})


# ---------------------------------------------------------------- les billets privés, les horloges

def test_les_billets_prives_de_chacun(strict):
    """Chaque MJ ne voit et ne retire que ses envois ; un envoi sans auteur est au principal."""
    f = tv_fiches.billets_prives.fichier
    avant = f.read_bytes() if f.exists() else None
    a, b = "a" * 24, "b" * 24
    try:
        tv_fiches.billets_prives.ecrire([
            {"id": a, "nature": "billet", "joueur": "x", "pour": "Bix", "titre": "Billet d'Alban", "texte": "SECRET-ALBAN", "envoye": "1"},
            {"id": b, "nature": "billet", "joueur": "x", "pour": "Bix", "titre": "Billet de Léa", "texte": "SECRET-LEA", "envoye": "2",
             "auteur": "lea"}])
        with lecteur("alban"):
            vus = tv_fiches.billets_prives.etat()["envois"]
            assert [x["id"] for x in vus] == [a] and "auteur" not in vus[0]
            with pytest.raises(Exception):
                tv_fiches.billets_prives.retirer(b)
        with lecteur("lea"):
            assert [x["id"] for x in tv_fiches.billets_prives.etat()["envois"]] == [b]
            with pytest.raises(Exception):
                tv_fiches.billets_prives.retirer(a)
            tv_fiches.billets_prives.retirer(b)
        assert [x["id"] for x in tv_fiches.billets_prives.lire()] == [a]
    finally:
        if avant is None:
            f.unlink(missing_ok=True)
        else:
            f.write_bytes(avant)


def test_les_horloges_de_chacun(deux, strict):
    client, alban, lea = deux
    avant = config.TABLE.read_bytes() if config.TABLE.exists() else None
    try:
        utilitaires.ecrire(config.TABLE, {"vue": "accueil"})
        client.post("/api/horloges", json={"nom": "Le rituel du baron", "parts": 4}, headers=alban)
        r = client.post("/api/horloges", json={"nom": "La marée monte", "parts": 6, "visible": True}, headers=lea).json()
        assert [h["nom"] for h in r["horloges"]] == ["La marée monte"]
        assert [h["nom"] for h in client.get("/api/horloges", headers=alban).json()["horloges"]] == ["Le rituel du baron"]
        assert "baron" not in client.get("/api/horloges", headers=lea).text and "baron" not in client.get("/api/table", headers=lea).text
        assert "La marée monte" not in [h.get("nom") for h in client.get("/api/table", headers=alban).json().get("horloges", [])]
        # Montrée à la TV, celle de Léa s'y voit pour tous ; celle d'Alban, cachée, nulle part.
        assert "La marée monte" in json.dumps(tv_etat.etat_public(tv_ecran.etat_table()), ensure_ascii=False)
        ident = next(h["id"] for h in horloges.de_l_etat(tv_ecran.etat_table()) if h["nom"] == "Le rituel du baron")
        assert client.patch(f"/api/horloges/{ident}", json={"pas": 1}, headers=lea).status_code == 404
        assert client.delete(f"/api/horloges/{ident}", headers=lea).json()["horloges"][0]["nom"] == "La marée monte"
        assert ident in [h["id"] for h in horloges.de_l_etat(tv_ecran.etat_table())]
    finally:
        if avant is None:
            config.TABLE.unlink(missing_ok=True)
        else:
            config.TABLE.write_bytes(avant)


def test_chaque_mj_a_sa_bibliotheque_d_images(deux, strict):
    # Recette du 11/11 : l'invité ne pouvait pas importer l'image d'un pion (404). Chacun a désormais la sienne.
    import io
    from PIL import Image
    client, alban, lea = deux
    flux = io.BytesIO()
    Image.new("RGBA", (16, 16), (200, 30, 30, 255)).save(flux, "PNG")
    png = flux.getvalue()
    r = client.post("/api/bibliotheque-images", files={"image": ("pion.png", png, "image/png")}, data={"nom": "Pion de Léa", "rayon": "Pions"}, headers=lea)
    assert r.status_code == 200, r.text
    image = r.json()
    assert image["nom"] == "Pion de Léa" and image["auteur"] == "lea"
    # Léa la voit ; Alban non ; la même image importée par Alban est une image à lui, pas « déjà rangée ».
    assert any(x["id"] == image["id"] for x in client.get("/api/bibliotheque-images", headers=lea).json()["images"])
    assert all(x["id"] != image["id"] for x in client.get("/api/bibliotheque-images", headers=alban).json()["images"])
    r2 = client.post("/api/bibliotheque-images", files={"image": ("pion.png", png, "image/png")}, headers=alban)
    assert r2.status_code == 200 and not r2.json().get("deja") and r2.json()["id"] != image["id"]
    # Aucun des deux ne renomme ni ne retire l'image de l'autre.
    assert client.patch(f"/api/bibliotheque-images/{image['id']}", json={"nom": "Pris"}, headers=alban).status_code == 404
    assert client.delete(f"/api/bibliotheque-images/{image['id']}", headers=alban).status_code == 404
    assert client.patch(f"/api/bibliotheque-images/{r2.json()['id']}", json={"nom": "Pris"}, headers=lea).status_code == 404
    assert client.patch(f"/api/bibliotheque-images/{image['id']}", json={"nom": "Pion renommé"}, headers=lea).status_code == 200
    assert client.delete(f"/api/bibliotheque-images/{image['id']}", headers=lea).status_code == 200
    client.delete(f"/api/bibliotheque-images/{r2.json()['id']}", headers=alban)
