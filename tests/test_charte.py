"""La charte visuelle des portraits et la file de peinture : les repères se déclenchent par les mots de la description
(sans tenir compte des accents ni des apostrophes typographiques), la consigne appuie le peuple et la palette, chaque
variante reçoit sa propre mise en scène, et une image que le contrôle juge à côté est repeinte deux fois au plus."""

import asyncio
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from ia import charte  # noqa: E402
from ia import illustrations  # noqa: E402
import main  # noqa: E402
from api import illustrations_api  # noqa: E402
from api import application  # noqa: E402

# Trois repères de la charte de la campagne d'exemple, recopiés ici : les essais ne dépendent pas du pack de campagne
# (campagne/univers.py), dont la charte peut porter d'autres peuples et d'autres ordres.
CHARTE_DES_ESSAIS = [{'id': 'nain',
  'type': 'peuple',
  'nom': 'Nains',
  'mots': ['nain', 'naine', 'nains', 'naines'],
  'appuyer': 'dwarf',
  'cadrage': 'mi-corps',
  'allure': "Petit et trapu (environ 1,30 m), très large d'épaules, torse en tonneau, cou épais, grosse tête, nez "
            'large, arcades lourdes, mains énormes, oreilles humaines. Les hommes portent une barbe longue et '
            'fournie, souvent tressée.',
  'couleurs': '',
  'interdits': 'grand, élancé, cou long, oreilles pointues, cornes, casque à cornes, visage fin de jeune premier',
  'a_valider': True},
 {'id': 'temple-aube',
  'type': 'faction',
  'nom': "Temple de l'Aube",
  'mots': ["de l'aube", 'temple de l aube'],
  'appuyer': '',
  'cadrage': '',
  'allure': "Tenue du Temple de l'Aube : blanc et ivoire, ornements dorés, soleil levant en emblème.",
  'couleurs': 'blanc, ivoire, or',
  'interdits': 'rouge, noir dominant',
  'a_valider': True},
 {'id': 'tour-noire',
  'type': 'faction',
  'nom': 'Gardes de la Tour noire',
  'mots': ['tour noire'],
  'appuyer': '',
  'cadrage': '',
  'allure': "Gardes d'élite en armure noire, cape gris fer.",
  'couleurs': 'noir, acier sombre, gris fer',
  'interdits': 'armure blanche, couleurs vives',
  'a_valider': True}]
DEPART = charte.nettoyer(CHARTE_DES_ESSAIS)


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture(autouse=True)
def charte_neuve():
    illustrations_api.CHARTE.unlink(missing_ok=True)
    yield
    illustrations_api.CHARTE.unlink(missing_ok=True)


def ids(description):
    return [e["id"] for e in charte.reperes(description, DEPART)]


def test_les_reperes_se_declenchent_par_les_mots_de_la_description():
    assert ids("Homme (nain), adulte, marchand") == ["nain"]
    assert ids("Femme (Naine), d'âge mûr, contrebandière") == ["nain"]
    assert ids("Homme (humain), adulte, Prêtre de l'Aube") == ["temple-aube"]
    assert ids("Archiviste du Temple de l’Aube") == ["temple-aube"]
    # Un mot dans un autre mot ne compte pas, ni l'aube d'une scène.
    assert ids("Un humain nainformé, levé dès l'aube") == []
    assert ids("Gardien de la Tour noire, fidèle de l'Aube") == ["temple-aube", "tour-noire"]


def test_nettoyer_borne_et_normalise():
    propre = charte.nettoyer([
        {"id": "Pas valide!", "nom": "Gnomes", "type": "dragon", "mots": "Gnome, GNÔMES , ,", "cadrage": "plein pied",
         "appuyer": "Gnome (1.4),  big   NOSE ,", "allure": "x" * 900},
        {"id": "gnomes", "nom": "Gnomes bis", "mots": ["gnome"]},
        "pas un repère",
    ])
    assert len(propre) == 2
    a, b = propre
    assert a["id"] == "gnomes" and a["type"] == "autre" and a["mots"] == ["gnome", "gnomes"] and a["cadrage"] == ""
    assert a["appuyer"] == "gnome, big nose" and len(a["allure"]) == charte.LONGUEURS["allure"]
    assert b["id"] != "gnomes" and b["id"].startswith("gnomes-bis")
    with pytest.raises(ValueError):
        charte.nettoyer({"entrees": []})


def test_reperes_en_texte_cadrage_appuis():
    trouves = charte.reperes("Homme (nain), prêtre de l'Aube", DEPART)
    texte = charte.en_texte(trouves)
    assert "Nains" in texte and "Temple de l'Aube" in texte and "à ne jamais montrer : rouge" in texte
    assert charte.cadrage(trouves) == "mi-corps" and charte.impose_couleurs(trouves)
    assert charte.appuis(trouves) == ["dwarf"]


def test_composer_portrait_appuie_le_peuple_et_la_palette():
    p = illustrations.composer_portrait("dwarf merchant, stocky", "olive green, , brass, Brass", ["dwarf"])
    assert p == "(dwarf:1.4), dwarf merchant, stocky, (color palette of olive green, brass:1.2)"
    # Une consigne déjà appuyée (réécrite par le MJ puis renvoyée) ne l'est pas deux fois.
    assert illustrations.composer_portrait(p, "", ["dwarf"]).count("(dwarf:") == 1


def test_chaque_variante_a_sa_mise_en_scene():
    scenes = illustrations.mises_en_scene(4)
    assert len(set(scenes)) == 4
    nains = illustrations.mises_en_scene(3, "mi-corps", sobre=True)
    assert all(s.startswith("half-body portrait") for s in nains)
    assert all(any(l in s for l in illustrations.LUMIERES_SOBRES) for s in nains)


def test_la_charte_s_enregistre_avec_sa_version(client):
    depart = client.get("/api/charte-visuelle").json()
    assert depart["modifie"] is None and [e["id"] for e in depart["entrees"]] == [e["id"] for e in charte.nettoyer(charte.CHARTE_DEPART)]
    entrees = depart["entrees"]
    entrees[0]["couleurs"] = "brun, cuivre"
    r = client.put("/api/charte-visuelle", json={"entrees": entrees, "version_base": None})
    assert r.status_code == 200 and r.json()["entrees"][0]["couleurs"] == "brun, cuivre"
    assert client.put("/api/charte-visuelle", json={"entrees": entrees, "version_base": "ancienne"}).status_code == 409
    assert client.put("/api/charte-visuelle", json={"entrees": "rien", "version_base": r.json()["modifie"]}).status_code == 422


def test_la_consigne_de_portrait_suit_la_charte(client, monkeypatch):
    vu = {}

    async def faux(description, couleurs="", reperes_texte="", appuis=None):
        vu.update(description=description, couleurs=couleurs, reperes=reperes_texte, appuis=appuis)
        return {"prompt": "(dwarf:1.4), dwarf", "negatif": "tall"}

    monkeypatch.setattr(illustrations_api, "ecrire_portrait", faux)
    r = client.post("/api/illustrations/prompt", json={"description": "Homme (nain), forgeron", "genre": "portrait", "couleurs": "gris"}).json()
    assert r == {"prompt": "(dwarf:1.4), dwarf", "negatif": "tall", "reperes": ["Nains"]}
    assert vu["couleurs"] == "gris" and vu["appuis"][0] == "dwarf" and "Petit et trapu" in vu["reperes"]


def test_la_commande_d_un_portrait_emporte_scene_interdits_et_controle(client, monkeypatch):
    pnj = client.post("/api/pnj", json={"nom": "Brune Barbe Essai", "peuple": "Nain"}).json()
    recus = []
    monkeypatch.setattr(application.atelier, "ajouter", lambda *a, **k: recus.append((a, k)) or [{"id": "x"}])
    r = client.post("/api/illustrations", json={"cible": "pnj", "fiche": pnj["id"], "prompt": "dwarf", "nombre": 2,
                                                "description": "Homme (nain), forgeron", "negatif": "tall", "couleurs": "gris"})
    assert r.status_code == 200
    (args, options), = recus
    assert args[6] == "portrait" and options["negatif"] == "tall" and options["cadrage"] == "mi-corps" and options["sobre"]
    assert options["controle"]["couleurs"] == "gris" and "Nains" in options["controle"]["reperes"]
    client.delete(f"/api/pnj/{pnj['id']}")


def faire_atelier(tmp_path, verdicts):
    """Un atelier sans ComfyUI ni API : peindre rend des octets numérotés, le contrôle rend les verdicts donnés."""
    gardees = []
    at = illustrations.Atelier(tmp_path, lambda cible, fiche, ill: gardees.append(ill))
    peintes = []

    async def peindre(client, t, positif, negatif, graine):
        peintes.append((positif, negatif, graine))
        return f"image-{len(peintes)}".encode()

    async def controler(jpeg, controle):
        return verdicts.pop(0)

    at.peindre = peindre
    return at, gardees, peintes, controler


def test_une_image_a_cote_est_repeinte_deux_fois_au_plus(tmp_path, monkeypatch):
    mauvais = {"conforme": False, "ecarts": "Il est grand et mince.", "ajouter": "short stocky dwarf", "eviter": "tall"}
    oreilles = {"conforme": False, "ecarts": "Oreilles pointues.", "ajouter": "", "eviter": "pointed ears"}
    at, gardees, peintes, controler = faire_atelier(tmp_path, [dict(mauvais), dict(oreilles), dict(mauvais)])
    monkeypatch.setattr(illustrations, "controler_portrait", controler)
    monkeypatch.setattr(illustrations, "reglages", lambda: {"prefixe_portrait": "P", "suffixe_portrait": "S", "negatif_portrait": "N"})
    t, = at.ajouter("pnj", "brune", "dwarf", "portrait", 1, "Homme (nain)", "portrait", negatif="elf ears",
                    cadrage="mi-corps", controle={"description": "Homme (nain)", "reperes": "", "couleurs": ""})
    asyncio.run(at.traiter(None, t))
    assert t["etat"] == "fini" and len(peintes) == illustrations.PEINTURES_MAX == 3
    (p1, n1, g1), (p2, n2, g2), (p3, n3, g3) = peintes
    assert p1.startswith("P, dwarf, half-body") and n1 == "N, elf ears"
    assert "(short stocky dwarf:1.3)" in p2 and n2 == "N, elf ears, tall" and g2 != g1
    # Chaque repeinte part de la consigne de départ avec la seule correction du dernier verdict.
    assert "short stocky dwarf" not in p3 and n3 == "N, elf ears, pointed ears" and g3 not in (g1, g2)
    ill, = gardees
    assert ill["controle"] == {"conforme": False, "ecarts": "Il est grand et mince.", "repeint": True}
    assert (tmp_path / ill["url"].removeprefix("/media/")).read_bytes() == b"image-3"
    assert "controle" not in at.etat()[0] and "description" not in at.etat()[0]


def test_une_repeinte_conforme_arrete_la_peinture(tmp_path, monkeypatch):
    oreilles = {"conforme": False, "ecarts": "Oreilles pointues.", "ajouter": "", "eviter": "pointed ears"}
    at, gardees, peintes, controler = faire_atelier(tmp_path, [dict(oreilles), {"conforme": True, "ecarts": "", "ajouter": "", "eviter": ""}])
    monkeypatch.setattr(illustrations, "controler_portrait", controler)
    t, = at.ajouter("pnj", "brune", "dwarf", "portrait", 1, "", "portrait", controle={"description": "x"})
    asyncio.run(at.traiter(None, t))
    ill, = gardees
    assert len(peintes) == 2 and ill["controle"] == {"conforme": True, "ecarts": "", "repeint": True}


def test_sans_verdict_l_image_est_gardee_telle_quelle(tmp_path, monkeypatch):
    at, gardees, peintes, controler = faire_atelier(tmp_path, [None])
    monkeypatch.setattr(illustrations, "controler_portrait", controler)
    t, = at.ajouter("pnj", "brune", "dwarf", "portrait", 1, "", "portrait", controle={"description": "x"})
    asyncio.run(at.traiter(None, t))
    assert len(peintes) == 1 and "controle" not in gardees[0] and t["etat"] == "fini"


def test_une_illustration_de_lieu_n_a_ni_scene_ni_controle(tmp_path):
    at, gardees, peintes, _ = faire_atelier(tmp_path, [])
    t, = at.ajouter("lieu", "village", "a village", "paysage", 1, "", "lieu", controle={"description": "x"})
    assert "scene" not in t and "controle" not in t


def test_si_la_repeinte_echoue_la_premiere_image_reste(tmp_path, monkeypatch):
    mauvais = {"conforme": False, "ecarts": "Des cornes.", "ajouter": "wool hood", "eviter": "horns"}
    at, gardees, peintes, controler = faire_atelier(tmp_path, [dict(mauvais)])
    monkeypatch.setattr(illustrations, "controler_portrait", controler)
    peindre = at.peindre

    async def une_seule(client, t, positif, negatif, graine):
        if peintes:
            raise RuntimeError("ComfyUI a perdu ce travail")
        return await peindre(client, t, positif, negatif, graine)

    at.peindre = une_seule
    t, = at.ajouter("pnj", "brune", "dwarf", "portrait", 1, "", "portrait", controle={"description": "x"})
    asyncio.run(at.traiter(None, t))
    ill, = gardees
    assert t["etat"] == "fini" and ill["prompt"] == "dwarf" and ill["graine"] == t["graine"]
    assert ill["controle"] == {"conforme": False, "ecarts": "Des cornes.", "repeint": False}


def test_un_portrait_prend_le_guidage_appuye_un_lieu_non():
    r = {"checkpoint": "m.safetensors", "pas": 6, "cfg": 2.0, "sampler": "dpmpp_sde", "scheduler": "karras",
         "cfg_portrait": 3.5, "apg_portrait": {"eta": 0.0, "norm_threshold": 5.0, "momentum": 0.0}}
    lieu = illustrations.construire_workflow("a village", "text", 832, 1216, 7, r)
    assert "apg" not in lieu and lieu["ech"]["inputs"]["cfg"] == 2.0 and lieu["ech"]["inputs"]["model"] == ["ckpt", 0]
    portrait = illustrations.construire_workflow("dwarf", "elf ears", 832, 1216, 7, r, portrait=True)
    assert portrait["apg"]["inputs"]["model"] == ["ckpt", 0] and portrait["apg"]["inputs"]["eta"] == 0.0
    assert portrait["ech"]["inputs"]["cfg"] == 3.5 and portrait["ech"]["inputs"]["model"] == ["apg", 0]
    # Sans réglage APG, un portrait garde le guidage commun.
    sans = {k: v for k, v in r.items() if k != "apg_portrait"}
    assert illustrations.construire_workflow("dwarf", "", 832, 1216, 7, sans, portrait=True)["ech"]["inputs"]["cfg"] == 2.0
