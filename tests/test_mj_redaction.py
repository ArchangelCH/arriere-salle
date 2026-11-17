"""La rédaction par l'API pour deux MJ : Alban et Léa, une MJ invitée (tests/deux_mj.py), ont chacun des
fiches canaris. Par chaque route de rédaction, ce que reçoit le faux modèle (tests/faux_modele.py) ne porte jamais un
canari de l'autre, ni pour Léa un secret de héros, « Mystères et flottements » ou le nom caché de l'auberge. Chaque appel
est noté pour son MJ ; chacun ne lit que ses coûts, ses estimations et ses lots ; le budget de Léa se vérifie avant
l'appel ; Telegram n'en dit rien. Sans invité, rien ne change pour Alban."""

import asyncio
import base64
import json
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
RACINE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RACINE / "app"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import io  # noqa: E402
from types import SimpleNamespace  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from ia import budget_mj  # noqa: E402
from mj import cloisonnement  # noqa: E402
from mj import comptes_mj  # noqa: E402
import deux_mj  # noqa: E402
from ia import illustrations  # noqa: E402
import main  # noqa: E402
from api import application, bible_api, config, contexte_du_modele, ia_api  # noqa: E402
from table import masque  # noqa: E402
from ia import redaction  # noqa: E402
from contenu import telegram  # noqa: E402
from faux_modele import FauxClient  # noqa: E402

CANARI = {"alban": "CANARI-ALBAN", "lea": "CANARI-LEA"}
PUBLIC = {"alban": "Publicalban", "lea": "Publiclea"}
SECRET_HEROS = "SECRET-HEROS"
MYSTERES = "CANARI-MYSTERES"
SUIVIS = ("table.json", "renommages.json", "etats-heros.json", "campagne.json")
PNG = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + bytes(40)).decode()


class Faux(FauxClient):
    """Le faux modèle : chaque demande notée, la même réponse (un objet JSON que toutes les routes savent lire ; la
    consigne d'un portrait y trouve son « prompt »). Les lots rendent, dans l'ordre, les textes de « reponses »."""

    def __init__(self):
        super().__init__()
        # Le contrôle d'un portrait passe par messages.create (sans repli serveur) : le faux modèle le reçoit aussi.
        self.messages.create = self.create

    def _suivante(self, kwargs):
        self.appels.append(kwargs)
        if self.erreur:
            raise self.erreur
        return '{"prompt": "a stout dwarf", "variantes": [{"apparence": "grand"}]}'


def carte(nom: str, notes: str, marqueurs=()) -> dict:
    n = 10 * 10
    return {"nom": nom, "notes": notes, "largeur": 10, "hauteur": 10, "km_case": 1, "terrain": base64.b64encode(bytes([1]) * n).decode(),
            "brouillard": base64.b64encode(bytes(n)).decode(), "marqueurs": list(marqueurs), "traces": [],
            "etiquettes": [{"id": "e1", "texte": notes, "cache": True}]}


def plan(nom: str, notes: str, lieu: str) -> dict:
    n = 6 * 6
    return {"nom": nom, "notes": notes, "lieu": lieu, "largeur": 6, "hauteur": 6, "sol": [1] * n, "piece": [1] * n,
            "brouillard": [1] * n, "pieces": [{"id": 1, "genre": "salle", "nom": f"{notes} salle", "notes": notes}], "portes": [],
            "objets": [], "pions": [], "textes": [{"id": "t1", "texte": notes, "x": 1, "y": 1, "mj": True}], "m_case": 1.5}


def semer(client, h: dict, qui: str) -> dict:
    """Les fiches d'un MJ : chacune porte son canari, sauf un PNJ et un lieu connus des joueurs (publics), et deux séances
    closes dont le « Précédemment » est lu aux joueurs (l'un nomme son PNJ secret)."""
    m, pub = CANARI[qui], PUBLIC[qui]
    ids = {}

    def creer(collection, fiche):
        r = client.post(f"/api/{collection}", json=fiche, headers=h)
        assert r.status_code == 200, (collection, r.status_code, r.text)
        return r.json()["id"]

    ids["pnj"] = creer("pnj", {"nom": f"{m} Zorglub{qui}", "connu": False, "secret": f"{m}-SECRET-PNJ", "notes": f"{m}-NOTES"})
    ids["pnj_connu"] = creer("pnj", {"nom": f"{pub} Bertrand", "connu": True, "role": "aubergiste", "secret": f"{m}-SECRET-CONNU"})
    ids["lieu_connu"] = creer("lieux", {"nom": f"{pub} Marché", "connu": True, "resume": f"{pub} place", "secrets": f"{m}-SECRET-MARCHE"})
    ids["carte"] = creer("cartes", carte(f"{m} carte", f"{m}-NOTES-CARTE"))
    ids["lieu"] = creer("lieux", {"nom": f"{m} Valombre{qui}", "connu": False, "resume": f"{m}-RESUME", "secrets": f"{m}-SECRET-LIEU",
                                  "carte": ids["carte"]})
    c = client.get(f"/api/cartes/{ids['carte']}", headers=h).json()
    c["marqueurs"] = [{"id": "a", "lieu": ids["lieu"], "x": 4, "y": 4}, {"id": "b", "lieu": ids["lieu_connu"], "x": 6, "y": 6}]
    c["version_base"] = c["modifie"]
    assert client.put(f"/api/cartes/{ids['carte']}", json=c, headers=h).status_code == 200
    texte = (f"{m} rencontre Zorglub{qui} à Valombre{qui}.\n\n[[carte blanche : une serveuse {m}]]\n\n[[pistes : la suite {m}]]\n\n"
             f"[[vérifier : Grimbal {m}]]\n\n[[pnj : un garde {m}]]\n\n[[combat : des loups {m}]]\n")
    ids["scenario"] = creer("scenarios", {"nom": f"{m} scénario", "resume": f"{m}-RESUME-SCENARIO",
                                          "chapitres": [{"id": "c1", "titre": f"{m} chapitre", "texte": texte}]})
    ids["plan"] = creer("plans", plan(f"{m} plan", f"{m}-NOTES-PLAN", ids["lieu"]))
    ids["seance"] = creer("seances", {"nom": f"{m} séance", "numero": 7, "notes": f"{m}-NOTES-SEANCE", "objectif": f"{m}-OBJECTIF",
                                      "close": True, "precedemment": f"Les héros ont croisé Zorglub{qui} au marché."})
    ids["seance_publique"] = creer("seances", {"nom": "Séance lue", "numero": 8, "close": True,
                                               "precedemment": f"{pub} a payé sa tournée."})
    ids["fil"] = creer("fils", {"nom": f"{m} fil", "but": f"{m}-BUT"})
    ids["idee"] = creer("idees", {"texte": f"{m} idée"})
    ids["rencontre"] = creer("rencontres", {"nom": f"{m} rencontre", "notes": f"{m}-NOTES-RENCONTRE"})
    return ids


@pytest.fixture(scope="module")
def monde(tmp_path_factory):
    lore = tmp_path_factory.mktemp("lore")
    (lore / "bible").mkdir()
    (lore / "glossaire.md").write_text("# Glossaire\n\n**Toma** : paladin, à la Petite Fanfrelée.", encoding="utf-8")
    (lore / "bible" / "ton-et-table.md").write_text("# Le ton\n\nUne comédie dans un univers sérieux.", encoding="utf-8")
    (lore / "bible" / "personnages.md").write_text("# Personnages\n\nGrimbal, nain du Calvère.", encoding="utf-8")
    (lore / "bible" / "mysteres-et-flottements.md").write_text(f"# Mystères\n\n{MYSTERES} : Grimbal et le secret.", encoding="utf-8")
    avant = {f for f in config.DONNEES.rglob("*") if f.is_file()}
    suivis = {n: (config.DONNEES / n).read_bytes() if (config.DONNEES / n).exists() else None for n in SUIVIS}
    with TestClient(application.app, raise_server_exceptions=False) as client, pytest.MonkeyPatch.context() as mp:
        mp.setattr(cloisonnement, "MODE", cloisonnement.STRICT)
        mp.setattr(bible_api, "LORE", lore)
        redaction.regler_sources_liens(contexte_du_modele.sources_des_liens)
        alban, lea = deux_mj.ouvrir(mp)
        ids = {"alban": semer(client, alban, "alban"), "lea": semer(client, lea, "lea")}
        heros = client.post("/api/aventuriers", headers=alban, json={
            "nom": "Naïma Ventebrise", "joueur": "Bix", "peuple": f"Demi-élémentaire {SECRET_HEROS}-PEUPLE", "peuple_cache": True,
            "secret": f"{SECRET_HEROS}-1", "notes_mj": f"{SECRET_HEROS}-2", "histoire": f"{SECRET_HEROS}-3", "jamais": f"{SECRET_HEROS}-4",
            "avant": f"{SECRET_HEROS}-5", "pourquoi": f"{SECRET_HEROS}-6", "particularites": f"{SECRET_HEROS}-7",
            "dons": [{"nom": f"{SECRET_HEROS}-DON", "cout": "1", "effet": "x"}], "element": "feu", "physique": 50,
            "competences": [{"nom": "Lames", "bonus": 10, "avec": "Physique"}], "tablee": True}).json()
        chemin = config.AVENTURIERS / f"{heros['id']}.json"
        chemin.write_text(json.dumps({**json.loads(chemin.read_text(encoding="utf-8")), "confie_au_mj": f"{SECRET_HEROS}-CONFIE"}),
                          encoding="utf-8")
        campagne = client.get("/api/campagne", headers=alban).json()
        client.put("/api/campagne", headers=alban, json={**campagne, "nom": f"{CANARI['alban']}-CAMPAGNE",
                                                          "reputations": [{"region": "Nord", "souvenir": f"{CANARI['alban']}-REPUTATION"}]})
        yield {"client": client, "alban": alban, "lea": lea, "ids": ids, "heros": heros["id"], "mp": mp}
        deux_mj.fermer()
        redaction.regler_sources_liens(contexte_du_modele.sources_des_liens)
    for n, contenu in suivis.items():
        if contenu is None:
            (config.DONNEES / n).unlink(missing_ok=True)
        else:
            (config.DONNEES / n).write_bytes(contenu)
    for f in sorted({f for f in config.DONNEES.rglob("*") if f.is_file()} - avant, reverse=True):
        f.unlink(missing_ok=True)


@pytest.fixture
def api(monde, tmp_path, monkeypatch):
    """Un faux modèle, un journal des coûts et des lots vides, et ce que Telegram enverrait."""
    faux = Faux()
    envois = []
    monkeypatch.setattr(redaction, "CLIENT", faux)
    monkeypatch.setattr(redaction, "JOURNAL", tmp_path / "journal-ia.jsonl")
    monkeypatch.setattr(redaction, "LOTS", tmp_path / "lots-ia.json")
    monkeypatch.setattr(telegram.Telegram, "envoyer", lambda self, texte: envois.append(texte) or True)
    # Le modèle local, injoignable : un repli éventuel ne répond pas, et ne part jamais vers l'API.
    monkeypatch.setattr(illustrations, "OLLAMA", "http://127.0.0.1:9")
    monkeypatch.setattr(cloisonnement, "MODE", cloisonnement.STRICT)
    cloisonnement.oublier()
    yield {**monde, "faux": faux, "envois": envois, "journal": tmp_path / "journal-ia.jsonl"}
    cloisonnement.oublier()


def interdits(lecteur: str) -> list:
    autre = "lea" if lecteur == "alban" else "alban"
    mots = [CANARI[autre], CANARI[autre].lower(), f"Zorglub{autre}", f"Valombre{autre}"]
    if lecteur == "lea":
        mots += [SECRET_HEROS, MYSTERES, "Demi-élémentaire"]
    return mots


def journal(chemin: Path) -> list:
    return [json.loads(x) for x in chemin.read_text(encoding="utf-8").splitlines()] if chemin.exists() else []


def toutes_les_routes(client, h: dict, ids: dict) -> list:
    """Chaque route de rédaction, une fois (sur les fiches du MJ). Rend [(nom, réponse)]."""
    reponses = []
    consignes = client.get(f"/api/scenarios/{ids['scenario']}/consignes", headers=h).json()["consignes"]
    assert {c["genre"] for c in consignes} == {"rediger", "pistes", "verifier", "pnj", "combat"}
    for c in consignes:
        reponses.append((f"consigne {c['genre']}", client.post(f"/api/flux/scenarios/{ids['scenario']}/consignes",
                                                               json={"cle": c["cle"], "rang": c["rang"]}, headers=h)))
    s = ids["scenario"]
    reponses.append(("relecture rapide", client.post(f"/api/flux/scenarios/{s}/relectures/c1?rapide=true", headers=h)))
    reponses.append(("relecture", client.post(f"/api/flux/scenarios/{s}/relectures/c1", headers=h)))
    reponses.append(("relecture d'ensemble", client.post(f"/api/flux/scenarios/{s}/relectures/ensemble", headers=h)))
    reponses.append(("relecture différée", client.post(f"/api/scenarios/{s}/relectures/c1/differee", headers=h)))
    fiche = {"nom": "Gaston", "role": "garde", "peuple": "humain"}
    reponses.append(("pnj variantes", client.post("/api/pnj-variantes", json={"fiche": fiche, "idee": "bourru"}, headers=h)))
    reponses.append(("pnj proposition", client.post("/api/pnj-proposition", json={"fiche": fiche, "idee": "bourru"}, headers=h)))
    reponses.append(("précédemment", client.post("/api/precedemment/redaction", json={"journal": "Ils ont bu.", "personnages": "Brom, joué par Lou"}, headers=h)))
    reponses.append(("consigne d'image", client.post("/api/illustrations/prompt", json={"description": "une tour"}, headers=h)))
    reponses.append(("consigne de portrait", client.post("/api/illustrations/prompt", json={"description": "un nain", "genre": "portrait"}, headers=h)))
    reponses.append(("lieu", client.post(f"/api/lieux/{ids['lieu']}/redaction", json={}, headers=h)))
    zone = {"x0": 0, "y0": 0, "x1": 10, "y1": 10}
    reponses.append(("peupler", client.post(f"/api/cartes/{ids['carte']}/peupler", json={"zone": zone, "nombre": 2, "image": PNG}, headers=h)))
    reponses.append(("plan programmé", client.post("/api/plans/programme", json={"demande": "une crypte", "lieu": ids["lieu"]}, headers=h)))
    reponses.append(("habillage de carte", client.post(f"/api/cartes/{ids['carte']}/habiller", json={"zone": zone, "image": PNG}, headers=h)))
    reponses.append(("habillage de plan", client.post(f"/api/plans/{ids['plan']}/habiller", json={"heure": "soir"}, headers=h)))
    return reponses


def test_sans_invite_rien_ne_change_pour_alban(tmp_path, monkeypatch):
    """Ni compte invité ni ligne d'un autre MJ : les coûts, les estimations et les lots d'Alban sont ceux d'avant le lot,
    et son contexte n'a ni la consigne de l'invité ni la bible des joueurs."""
    monkeypatch.setattr(redaction, "JOURNAL", tmp_path / "journal-ia.jsonl")
    monkeypatch.setattr(redaction, "LOTS", tmp_path / "lots-ia.json")
    monkeypatch.setattr(contexte_du_modele.budgets, "donnees", tmp_path)
    (tmp_path / "journal-ia.jsonl").write_text("".join(json.dumps(x) + "\n" for x in [
        {"date": f"{budget_mj.mois_courant()}-01T10:00:00", "fonction": "relecture", "cout": 1.2, "entree": 13000, "sortie": 9000,
         "cache_ecrit": 300000, "cache_lu": 0},
        {"date": f"{budget_mj.mois_courant()}-01T11:00:00", "fonction": "aide-relire", "cout": 0.03, "qui": "joueur-lou"}]), encoding="utf-8")
    (tmp_path / "lots-ia.json").write_text(json.dumps([{"id": "l", "fonction": "relecture", "cible": {"scenario": "efface"},
                                                         "cree": "2026-11-01T00:00:00", "etat": "fait"}]), encoding="utf-8")
    cloisonnement.oublier()
    jeton = cloisonnement.poser_lecteur("alban")
    try:
        assert contexte_du_modele.budgets.couts() == redaction.couts()
        assert contexte_du_modele.budgets.estimations() == redaction.estimations()
        assert ia_api.lots_ia() == redaction.lots()
        # Ni ses coûts, ni ses estimations, ni ses lots ne notent rien au journal du cloisonnement.
        assert cloisonnement.vues() == []
        assert contexte_du_modele.contexte_ia("leger")[0]["text"] == contexte_du_modele.CONSIGNE_GENERALE
    finally:
        cloisonnement.retirer_lecteur(jeton)


@pytest.mark.parametrize("lecteur", ["alban", "lea"])
def test_rien_de_l_autre_dans_ce_que_recoit_le_modele(api, lecteur):
    client, h, ids, faux = api["client"], api[lecteur], api["ids"][lecteur], api["faux"]
    reponses = toutes_les_routes(client, h, ids)
    assert all(r.status_code < 500 for _, r in reponses), [(n, r.status_code, r.text[:200]) for n, r in reponses if r.status_code >= 500]
    appels = [json.dumps(a, ensure_ascii=False) for a in faux.appels]
    lots = [json.dumps(l, ensure_ascii=False) for l in faux.messages.batches.crees]
    # Chaque route est partie vers le modèle (les PNJ, le « Précédemment » et les consignes d'image par l'API d'abord).
    assert len(appels) >= len(reponses) - 1 and len(lots) == 1, (len(appels), [n for n, _ in reponses])
    for texte in appels + lots:
        assert [m for m in interdits(lecteur) if m in texte] == []
        if lecteur == "lea":
            assert not masque.contient_nom_cache(texte)
    tout = "\n".join(appels + lots)
    # Son propre contexte, lui, part bien : ses canaris, et le monde que connaissent les joueurs (les deux MJ).
    assert CANARI[lecteur] in tout and f"{PUBLIC['alban']} Bertrand" in tout and f"{PUBLIC['lea']} Bertrand" in tout
    # Chaque appel est noté pour lui, le lot compris (au relevé).
    asyncio.run(redaction.relever_lots(lambda cible, texte: None))
    notes = journal(api["journal"])
    assert notes and {x.get("qui") for x in notes} == {f"mj:{lecteur}"}
    assert any(x["lot"] for x in notes)
    assert api["envois"] == []


def test_le_contexte_de_l_invite(api):
    client, lea, alban = api["client"], api["lea"], api["alban"]
    client.post(f"/api/flux/scenarios/{api['ids']['lea']['scenario']}/relectures/c1", headers=lea)
    client.post(f"/api/flux/scenarios/{api['ids']['alban']['scenario']}/relectures/c1", headers=alban)
    client.post("/api/precedemment/redaction", json={"journal": "Ils ont bu."}, headers=lea)
    client.post("/api/precedemment/redaction", json={"journal": "Ils ont bu."}, headers=alban)
    a_lea, a_alban, p_lea, p_alban = api["faux"].appels
    # Mêmes blocs et mêmes durées de cache, mais un début à soi : le cache de l'un ne sert jamais l'autre.
    ttl = lambda a: [b.get("cache_control", {}).get("ttl") for b in a["system"]]  # noqa: E731
    assert ttl(a_lea) == ttl(a_alban) == [None, "1h", "1h", "5m"] and ttl(p_lea) == ttl(p_alban) == [None, "1h", "5m"]
    assert a_alban["system"][0]["text"] == contexte_du_modele.CONSIGNE_GENERALE
    assert a_lea["system"][0]["text"] != a_alban["system"][0]["text"] and contexte_du_modele.CONSIGNE_INVITE in a_lea["system"][0]["text"]
    # La bible des joueurs : ni « Mystères et flottements », ni le nom caché de l'auberge (au masque).
    assert MYSTERES in a_alban["system"][2]["text"] and MYSTERES not in a_lea["system"][2]["text"]
    assert "Grimbal, nain" in a_lea["system"][2]["text"]
    assert "Petite Fanfrelée" in a_alban["system"][1]["text"] and not masque.contient_nom_cache(a_lea["system"][1]["text"])
    # Son état de la campagne : ses fiches, la tablée sans ses secrets, le monde, ni le nom ni les réputations d'Alban.
    etat = a_lea["system"][3]["text"]
    assert f"{CANARI['lea']} Zorglublea" in etat and "Naïma Ventebrise" in etat and "Lames 60 %" in etat
    assert f"{PUBLIC['alban']} Marché" in etat and f"{PUBLIC['alban']} Bertrand" in etat
    assert "CAMPAGNE" not in etat and "REPUTATION" not in etat and SECRET_HEROS not in etat
    assert f"{CANARI['alban']}-CAMPAGNE" in a_alban["system"][3]["text"]
    # Ce que savent les joueurs : les deux MJ, sauf la ligne qui nomme le secret de l'autre.
    pub_lea, pub_alban = p_lea["system"][2]["text"], p_alban["system"][2]["text"]
    assert f"{PUBLIC['alban']} a payé" in pub_lea and "Zorglubalban" not in pub_lea and "Zorglublea" in pub_lea
    assert f"{PUBLIC['lea']} a payé" in pub_alban and "Zorglublea" not in pub_alban and "Zorglubalban" in pub_alban


def test_le_budget_de_l_invite_bloque_avant_l_appel(api, monkeypatch):
    client, lea, alban, faux = api["client"], api["lea"], api["alban"], api["faux"]
    ids = api["ids"]
    mois = budget_mj.mois_courant()
    with comptes_mj.verrou(config.DONNEES):
        etat = comptes_mj.lire(config.DONNEES)
        assert comptes_mj.par_id(etat, "lea")["budget_mois"] == 3.0
    # Alban règle le budget de Léa ; Léa ne le peut pas ; une valeur folle est refusée.
    assert client.put("/api/mj/comptes/lea/budget", json={"budget_mois": 0.5}, headers=alban).json()["budget_mois"] == 0.5
    assert client.put("/api/mj/comptes/lea/budget", json={"budget_mois": 50}, headers=lea).status_code == 404
    assert client.put("/api/mj/comptes/lea/budget", json={"budget_mois": 1000}, headers=alban).status_code == 400
    assert client.put("/api/mj/comptes/lea/budget", json={"budget_mois": "3"}, headers=alban).status_code == 400
    assert client.put("/api/mj/comptes/alban/budget", json={"budget_mois": 3}, headers=alban).status_code == 404
    # 0,49 $ dépensés : une demande qui en coûterait au moins 0,01 de plus ne part pas.
    api["journal"].write_text(json.dumps({"date": f"{mois}-01T10:00:00", "fonction": "consigne", "cout": 0.49, "qui": "mj:lea"}) + "\n",
                              encoding="utf-8")
    r = client.post(f"/api/lieux/{ids['lea']['lieu']}/redaction", json={}, headers=lea)
    assert r.status_code == 402 and "au moins" in r.json()["detail"] and "il reste 0,01 $" in r.json()["detail"]
    fin = client.post(f"/api/flux/scenarios/{ids['lea']['scenario']}/relectures/c1", headers=lea).text
    assert "au moins" in fin and '"t": "erreur"' in fin
    assert faux.appels == []
    # Atteint : 402 avant même le flux, et un message clair.
    with api["journal"].open("a", encoding="utf-8") as f:
        f.write(json.dumps({"date": f"{mois}-02T10:00:00", "fonction": "consigne", "cout": 0.02, "qui": "mj:lea"}) + "\n")
    r = client.post(f"/api/flux/scenarios/{ids['lea']['scenario']}/relectures/c1", headers=lea)
    assert r.status_code == 402 and r.json()["detail"].startswith("Budget de rédaction du mois atteint : 0,51 $ sur 0,50 $")
    assert client.post(f"/api/scenarios/{ids['lea']['scenario']}/relectures/c1/differee", headers=lea).status_code == 402
    assert client.post("/api/pnj-variantes", json={"fiche": {"nom": "x"}}, headers=lea).status_code == 402
    # Les PNJ et les consignes d'image passent au modèle local (ici injoignable), jamais à l'API.
    assert client.post("/api/pnj-proposition", json={"fiche": {"nom": "x"}}, headers=lea).status_code == 503
    assert faux.appels == [] and faux.messages.batches.crees == []
    # Le contrôle d'un portrait commandé par Léa : sans verdict, sans appel.
    image = io.BytesIO()
    Image.new("RGB", (32, 32), (120, 80, 40)).save(image, "JPEG")
    assert asyncio.run(illustrations.controler_portrait(image.getvalue(), {"description": "un nain", "qui": "mj:lea"})) is None
    assert faux.appels == []
    # Alban n'a pas de budget : ni les 500 $ qu'il aurait dépensés, ni ceux de Léa ne l'arrêtent.
    with api["journal"].open("a", encoding="utf-8") as f:
        f.write(json.dumps({"date": f"{mois}-02T11:00:00", "fonction": "relecture", "cout": 500, "qui": "mj:alban"}) + "\n")
    assert client.post(f"/api/lieux/{ids['alban']['lieu']}/redaction", json={}, headers=alban).status_code == 200
    assert len(faux.appels) == 1
    # Relevé par Alban, il repart.
    assert client.put("/api/mj/comptes/lea/budget", json={"budget_mois": 5}, headers=alban).status_code == 200
    assert client.post(f"/api/lieux/{ids['lea']['lieu']}/redaction", json={}, headers=lea).status_code == 200
    assert len(faux.appels) == 2
    client.put("/api/mj/comptes/lea/budget", json={"budget_mois": 3}, headers=alban)
    assert api["envois"] == []


def test_deux_appels_a_la_fois_ne_passent_pas_tous_deux_sous_le_plafond(api):
    budgets = contexte_du_modele.budgets
    appel = {"qui": "mj:lea", "systeme": [{"type": "text", "text": "x" * 120_000}], "contenu": "y", "lot": False}
    prix = redaction.plancher(appel["systeme"], appel["contenu"])
    assert 0.2 < prix < 0.3
    client = api["client"]
    client.put("/api/mj/comptes/lea/budget", json={"budget_mois": 0.4}, headers=api["alban"])
    liberer = budgets.garde(appel)
    with pytest.raises(redaction.BudgetAtteint):
        budgets.garde(appel)
    liberer()
    budgets.garde(appel)()
    # Un lot pas encore relevé reste engagé : son prix minimal compte jusqu'au relevé.
    api["journal"].write_text("", encoding="utf-8")
    redaction.LOTS.write_text(json.dumps([{"id": "l1", "etat": "en-cours", "qui": "mj:lea", "plancher": 0.39, "cree": "2026-11-01T00:00:00"}]),
                              encoding="utf-8")
    assert budgets.depense("lea") == pytest.approx(0.39)
    with pytest.raises(redaction.BudgetAtteint):
        budgets.garde(appel)
    # Rien pour Alban, pour un joueur (ses quotas à part) ni pour une tâche de fond.
    for qui in ("mj:alban", "joueur-1", None):
        assert budgets.garde({**appel, "qui": qui}) is None
    client.put("/api/mj/comptes/lea/budget", json={"budget_mois": 3}, headers=api["alban"])


def test_chacun_ses_couts_ses_estimations_et_ses_lots(api):
    client, lea, alban = api["client"], api["lea"], api["alban"]
    ids = api["ids"]
    mois = budget_mj.mois_courant()
    lignes = [
        {"date": f"{mois}-03T10:00:00", "fonction": "consigne", "cout": 0.4, "entree": 5000, "sortie": 3000, "cache_ecrit": 44000, "cache_lu": 0, "qui": "mj:alban"},
        {"date": f"{mois}-03T11:00:00", "fonction": "consigne", "cout": 0.1, "entree": 5000, "sortie": 3000, "cache_ecrit": 0, "cache_lu": 44000},
        {"date": f"{mois}-03T12:00:00", "fonction": "aide-proposer", "cout": 0.02, "qui": "joueur-ben"},
        {"date": f"{mois}-03T13:00:00", "fonction": "lieu", "cout": 0.3, "entree": 900, "sortie": 800, "cache_ecrit": 30000, "cache_lu": 0, "qui": "mj:lea"},
    ]
    api["journal"].write_text("".join(json.dumps(x) + "\n" for x in lignes), encoding="utf-8")
    vu_lea = client.get("/api/ia/couts", headers=lea).json()
    assert vu_lea["total"] == 0.3 and vu_lea["appels"] == 1 and vu_lea["joueurs"] == [] and "mj" not in vu_lea
    assert [d["fonction"] for d in vu_lea["detail"]] == ["lieu"] and len(vu_lea["derniers"]) == 1
    assert vu_lea["budget"]["budget"] == 3.0 and vu_lea["budget"]["depense"] == 0.3 and vu_lea["budget"]["atteint"] is False
    vu = client.get("/api/ia/couts", headers=alban).json()
    # Alban : le total (Léa comprise), le détail sans elle, les joueurs (jamais un MJ), la part de Léa.
    assert vu["total"] == pytest.approx(0.82) and vu["appels"] == 4
    assert {d["fonction"] for d in vu["detail"]} == {"consigne", "aide-proposer"}
    assert [j["qui"] for j in vu["joueurs"]] == ["joueur-ben"]
    assert all(x.get("qui") != "mj:lea" for x in vu["derniers"])
    assert vu["mj"] == [{"compte": "lea", "nom": "Léa", "appels": 1, "cout": 0.3, "budget": vu_lea["budget"]}]
    # Les estimations : celles de Léa d'après ses seuls appels (elle n'a jamais demandé de consigne).
    est_lea = client.get("/api/ia/estimations", headers=lea).json()
    est = client.get("/api/ia/estimations", headers=alban).json()
    assert est_lea["usages"]["consigne"]["connu"] is False and est_lea["usages"]["lieu"]["connu"] is True
    assert est["usages"]["consigne"]["connu"] is True and est["usages"]["lieu"]["connu"] is False and "budget" not in est
    assert est_lea["budget"]["reste"] == pytest.approx(2.7)
    # Les lots : chacun les siens, sans ce que le serveur en garde (le MJ, le prix minimal).
    client.post(f"/api/scenarios/{ids['lea']['scenario']}/relectures/c1/differee", headers=lea)
    client.post(f"/api/scenarios/{ids['alban']['scenario']}/relectures/c1/differee", headers=alban)
    tous = redaction.lots()
    assert [x["qui"] for x in tous] == ["mj:lea", "mj:alban"] and all(x["plancher"] > 0 for x in tous)
    lots_lea, lots_alban = client.get("/api/ia/lots", headers=lea).json(), client.get("/api/ia/lots", headers=alban).json()
    assert [x["cible"]["scenario"] for x in lots_lea] == [ids["lea"]["scenario"]]
    assert [x["cible"]["scenario"] for x in lots_alban] == [ids["alban"]["scenario"]]
    assert all("qui" not in x and "plancher" not in x for x in lots_lea + lots_alban)
    # Engagé jusqu'au relevé, puis payé par son MJ.
    assert client.get("/api/ia/couts", headers=lea).json()["budget"]["depense"] == pytest.approx(0.3 + tous[0]["plancher"], abs=1e-3)
    api["faux"].reponses = ["Relu par le lot de Léa.", "Relu par le lot d'Alban."]
    asyncio.run(redaction.relever_lots(ia_api.deposer_lot))
    releves = [x for x in journal(api["journal"]) if x.get("lot")]
    assert [x["qui"] for x in releves] == ["mj:lea", "mj:alban"]
    assert client.get(f"/api/scenarios/{ids['lea']['scenario']}", headers=lea).json()["relectures"]["c1"]["texte"] == "Relu par le lot de Léa."
    assert client.get(f"/api/scenarios/{ids['alban']['scenario']}", headers=alban).json()["relectures"]["c1"]["texte"] == "Relu par le lot d'Alban."
    assert client.get("/api/ia/couts", headers=lea).json()["budget"]["depense"] == pytest.approx(0.3 + releves[0]["cout"], abs=1e-4)
    assert api["envois"] == []


def test_le_controle_d_un_portrait_est_paye_par_le_mj_qui_l_a_commande(api, monkeypatch, tmp_path):
    client, lea = api["client"], api["lea"]
    commandes = []
    monkeypatch.setattr(application.atelier, "ajouter", lambda *a, **k: commandes.append(k) or [{"id": "t1"}])
    r = client.post("/api/illustrations", json={"cible": "pnj", "fiche": api["ids"]["lea"]["pnj"], "prompt": "dwarf", "genre": "portrait",
                                                "description": "un nain"}, headers=lea)
    assert r.status_code == 200 and commandes[-1]["qui"] == "mj:lea"
    # La file garde le MJ avec le contrôle, qu'elle ne montre jamais ; le contrôle, fait plus tard, lui est noté.
    file = illustrations.Atelier(tmp_path, lambda *a: None)
    t, = file.ajouter("pnj", "x", "dwarf", "portrait", 1, "un nain", "portrait", controle={"description": "un nain"}, qui="mj:lea")
    assert t["controle"]["qui"] == "mj:lea" and all("controle" not in x and "qui" not in x for x in file.etat())
    image = io.BytesIO()
    Image.new("RGB", (32, 32), (120, 80, 40)).save(image, "JPEG")
    asyncio.run(illustrations.controler_portrait(image.getvalue(), t["controle"]))
    appel, = api["faux"].appels
    assert "mj:lea" not in json.dumps(appel, ensure_ascii=False)
    assert [x["qui"] for x in journal(api["journal"])] == ["mj:lea"]


class ModeleLocal:
    """Le modèle local du serveur (Ollama), remplacé : chaque demande notée, une réponse que toutes les routes savent lire."""
    envois: list = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, adresse, json=None, **kwargs):
        if adresse.endswith("/api/generate") and json and json.get("prompt"):
            ModeleLocal.envois.append(json)
        reponse = '{"apparence": "grand et sec", "prompt": "a stout dwarf"}'
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"response": reponse}, status_code=200)

    async def get(self, *args, **kwargs):
        return SimpleNamespace(json=lambda: {"models": []}, status_code=200)


def test_le_modele_local_ne_recoit_que_la_demande_du_mj(api, monkeypatch):
    """Le modèle local répond quand l'API ne part pas (budget de Léa à zéro, ou pas de clé pour Alban) : il ne reçoit que la
    consigne de la tâche et ce qu'envoie la page du MJ, jamais le contexte de la campagne ni rien de l'autre MJ."""
    client, lea, alban, faux = api["client"], api["lea"], api["alban"], api["faux"]
    monkeypatch.setattr(illustrations.httpx, "AsyncClient", ModeleLocal)
    client.put("/api/mj/comptes/lea/budget", json={"budget_mois": 0}, headers=alban)
    try:
        for qui, h in (("lea", lea), ("alban", alban)):
            if qui == "alban":
                monkeypatch.setattr(redaction, "CLIENT", None)
            ModeleLocal.envois = []
            assert client.post("/api/pnj-proposition", json={"fiche": {"nom": f"Gaston {qui}"}}, headers=h).json() == {"apparence": "grand et sec"}
            assert client.post("/api/precedemment/redaction", json={"journal": f"Ils ont bu {qui}."}, headers=h).status_code == 200
            assert client.post("/api/illustrations/prompt", json={"description": f"une tour {qui}"}, headers=h).status_code == 200
            assert client.post("/api/illustrations/prompt", json={"description": f"un nain {qui}", "genre": "portrait"}, headers=h).status_code == 200
            assert len(ModeleLocal.envois) == 4
            texte = json.dumps(ModeleLocal.envois, ensure_ascii=False)
            assert [m for m in interdits(qui) if m in texte] == [] and CANARI[qui] not in texte
            assert all(f" {qui}" in e["prompt"] for e in ModeleLocal.envois)
    finally:
        client.put("/api/mj/comptes/lea/budget", json={"budget_mois": 3}, headers=alban)
    assert faux.appels == [] and journal(api["journal"]) == []
