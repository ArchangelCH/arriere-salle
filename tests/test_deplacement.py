"""Bouger son pion (lot E2, deplacement.py, mouvements.py) : le joueur touche son pion dans le coin, puis une case ; le coin
prévalide sur ce qu'il a publié, l'atelier revérifie sur le plan du moment, pose le pion, révèle la pièce où le héros
entre si le MJ le permet, et note le mouvement. Pions libres, à valider ou figés ; en combat, à son tour seulement, dans la
limite du tour comptée depuis sa case du début du tour. L'éditeur du MJ en retard ne perd rien : les mouvements se
rejouent sur ce qu'il envoie. Et les fuites : une porte secrète voisine n'ouvre aucun chemin, un pion caché à l'arrivée ne
fait rien refuser, aucun refus ne dit rien de caché."""
import json
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

from coin_mj import boite as boite_mod  # noqa: E402
from commun import demandes  # noqa: E402
from commun import deplacement as dp  # noqa: E402
import joueurs  # noqa: E402
import main  # noqa: E402
from api import application, config, tv_etat, tv_plans, utilitaires  # noqa: E402
from coin_mj import mouvements  # noqa: E402
from commun import table_joueurs  # noqa: E402
from comptes_coin import entrer as entrer_au_coin  # noqa: E402

ICI = Path(__file__).resolve().parent
CAS = json.loads((ICI / "deplacement-cas.json").read_text(encoding="utf-8"))["cas"]
W, H = 8, 4
SECRETS = ("EMBUSCADE-SECRETE", "GOBELIN-DU-NOIR", "SALLE-CACHEE", "NOTE-", "secrete", "verrouillee", "PIEGE", "aventurier:")


# ---------------------------------------------------------------- les cas communs, sans serveur

@pytest.mark.parametrize("c", CAS, ids=[c["nom"] for c in CAS])
def test_les_cas_communs(c):
    try:
        r = dp.verifier(c["plan"], c["corps"], c["regles"], c["tour"])
        obtenu = {"distance": r["distance"], "entree": r["entree"], "portes": len(r["portes"])}
        assert r["chemin"] == c["chemin"]
    except dp.Refus as refus:
        obtenu = {"refus": refus.message}
        assert c["chemin"] is None
    assert obtenu == c["attendu"]
    g = dp.Grille(c["plan"], c["corps"]["pion"])
    if g.moi is not None:
        vus = dp.atteignables(c["plan"], "moi", dp.case_du_pion(g.moi), c["regles"].get("entrer") is True)
        assert sorted(f"{x},{y},{d}{',e' if e else ''}{f',p{n}' if n else ''}" for (x, y), (d, e, n) in vus.items()) == sorted(c["atteignables"])


def test_le_mobilier_suit_modele_js():
    """Les meubles qu'on traverse et ceux qui barrent : la même liste que plan/modele.js (MOBILIER)."""
    source = (ICI.parent / "app" / "static" / "js" / "plan" / "modele.js").read_text(encoding="utf-8")
    bloc = source[source.index("export const MOBILIER"):source.index("export const MEUBLES")]
    entrees = re.findall(r"\{ cle: \"([a-z-]+)\"[^}]*\}", bloc)
    franchissables = {m for m in re.findall(r"\{ cle: \"([a-z-]+)\"[^}]*franchissable: true[^}]*\}", bloc)}
    assert set(entrees) == dp.MEUBLES
    assert franchissables == dp.FRANCHISSABLES


def test_la_demande_se_valide():
    bon = {"plan": "a" * 20, "pion": "t-aude", "depuis": [0, 2], "vers": [2, 2]}
    assert dp.valider(bon) == bon
    for mauvais in ({**bon, "plan": "../x"}, {**bon, "pion": "<script>"}, {**bon, "vers": [1]}, {**bon, "vers": [1.5, 2]},
                    {**bon, "vers": [True, 2]}, {**bon, "depuis": [-1, 0]}, {**bon, "vers": [0, 9999]}, {**bon, "x": 1}, "texte"):
        with pytest.raises(dp.Refus):
            dp.valider(mauvais)


def test_les_versions_montent_toujours():
    assert mouvements.plus_tard("2026-11-08T12:00:00.500", "2026-11-08T12:00:00.500") == "2026-11-08T12:00:00.501"
    assert mouvements.plus_tard("2026-11-08T12:00:00.500", "2026-11-08T12:00:00.400") == "2026-11-08T12:00:00.501"
    assert mouvements.plus_tard("2026-11-08T12:00:00.500", "2026-11-08T12:00:01.000") == "2026-11-08T12:00:01.000"
    assert mouvements.plus_tard(None, "2026-11-08T12:00:01.000") == "2026-11-08T12:00:01.000"


def test_un_deplacement_ne_part_jamais_sur_telegram():
    g = demandes.GENRES[dp.GENRE]
    assert g.silencieux and g.annulable and not g.carnet and g.liste
    el = {"type": "demande", "joueur": "lea", "joueur_nom": "Léa", "id": "a" * 12, "genre": dp.GENRE, "statut": "en-attente"}
    assert boite_mod.Boite.cles_presentes([el], [])[f"d:lea:{'a' * 12}"][2] is False


# ---------------------------------------------------------------- l'atelier et le coin

def attendre(condition, delai=6.0):
    fin = time.monotonic() + delai
    while time.monotonic() < fin:
        r = condition()
        if r:
            return r
        time.sleep(0.03)
    return None


def grille(cases: dict, defaut=0) -> list:
    return [cases.get((x, y), defaut) for y in range(H) for x in range(W)]


def plan_d_essai(aude: str, bertrand: str, porte="ouverte") -> dict:
    """La salle A (x < 4) révélée, la salle B (x >= 4) cachée. Entre elles, une porte secrète non découverte, ouverte, en
    y = 1, et une porte ordinaire en y = 3. Dans A : Aude en (0, 2), Bertrand en (1, 0), un adversaire en embuscade
    (caché) en (2, 2), un garde visible en (3, 0), une table en (0, 0)-(1, 0) ; dans B, un gobelin dans le noir."""
    return {
        "nom": "Plan des déplacements", "lieu": "", "largeur": W, "hauteur": H, "m_case": 1.5, "brouillard_actif": True,
        "notes": "NOTE-PLAN", "style": "couleur",
        "sol": [2] * (W * H), "piece": grille({(x, y): 1 if x < 4 else 2 for y in range(H) for x in range(W)}),
        "brouillard": grille({(x, y): 1 if x < 4 else 0 for y in range(H) for x in range(W)}),
        "pieces": [{"id": 1, "nom": "La grande salle", "genre": "salle", "nom_visible": True},
                   {"id": 2, "nom": "SALLE-CACHEE", "genre": "salle", "notes": "NOTE-SALLE-B", "nom_visible": True}],
        "portes": [{"id": "porte-s", "sens": "v", "x": 4, "y": 1, "genre": "secrete", "etat": "ouverte", "decouverte": False, "note": "NOTE-PORTE"},
                   {"id": "porte-p", "sens": "v", "x": 4, "y": 3, "genre": "porte", "etat": porte}],
        "objets": [{"id": "o-table", "cle": "table", "x": 0, "y": 0, "l": 2, "h": 1, "rot": 0},
                   {"id": "o-piege", "cle": "piege", "x": 1, "y": 3, "l": 1, "h": 1, "cache": True, "note": "PIEGE-A-FOSSE"}],
        "pions": [{"id": "t-aude", "genre": "heros", "nom": "Aude", "ref": f"aventurier:{aude}", "x": 0.5, "y": 2.5},
                  {"id": "t-bertrand", "genre": "heros", "nom": "Bertrand", "ref": f"aventurier:{bertrand}", "x": 2.5, "y": 1.5},
                  {"id": "t-cache", "genre": "ennemi", "nom": "EMBUSCADE-SECRETE", "court": "1", "x": 2.5, "y": 2.5, "cache": True},
                  {"id": "t-garde", "genre": "ennemi", "nom": "Garde", "court": "2", "x": 3.5, "y": 0.5},
                  {"id": "t-noir", "genre": "ennemi", "nom": "GOBELIN-DU-NOIR", "court": "3", "x": 6.5, "y": 1.5}],
        "textes": [],
    }


@pytest.fixture(scope="module")
def atelier():
    with TestClient(application.app) as c:
        yield c


def nouveau_coin():
    return TestClient(joueurs.app)


@pytest.fixture(scope="module")
def monde(atelier):
    """Deux joueurs reliés à leur héros (Léa pour Aude, Basile pour Bertrand), une séance du jour."""
    patch = pytest.MonkeyPatch()
    patch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    patch.setattr(joueurs, "COOKIE_SUR", False)
    patch.setattr(joueurs, "HOTES", set())
    crees, invites = [], []

    def creer(collection, **fiche):
        f = atelier.post(f"/api/{collection}", json=fiche).json()
        crees.append((collection, f["id"]))
        return f

    aude = creer("aventuriers", nom="Aude de Valcombe", genre="f", tablee=True, couleur="#2e7d32")
    bertrand = creer("aventuriers", nom="Bertrand Lavelle", genre="h", tablee=True, couleur="#1565c0")
    m = {"aude": aude, "bertrand": bertrand}
    for cle, nom, heros in (("lea", "Léa", aude), ("basile", "Basile", bertrand)):
        invite = atelier.post("/api/joueurs", json={"nom": nom}).json()
        invites.append(invite["id"])
        assert atelier.post(f"/api/joueurs/{invite['id']}/relier", json={"heros": heros["id"]}).status_code == 200
        coin = nouveau_coin()
        entrer_au_coin(coin, invite)
        m[cle], m[f"{cle}_id"] = coin, invite["id"]
    m["seance"] = creer("seances", nom="Séance des déplacements", numero=4, date="2026-11-08")
    m["creer"] = creer
    yield m
    atelier.put("/api/table-joueurs", json={"ouverte": False, "pions": "a-valider", "distance": 12, "distance_combat": 6, "entrer": True})
    atelier.delete(f"/api/seances/{m['seance']['id']}/combat")
    atelier.put("/api/table", json={"vue": "accueil"})
    for ident in invites:
        atelier.delete(f"/api/joueurs/{ident}")
    for collection, ident in crees:
        atelier.delete(f"/api/{collection}/{ident}")
    tv_etat.TABLE_JOUEURS.unlink(missing_ok=True)
    table_joueurs.fermer(config.PROPOSITIONS)
    patch.undo()


@pytest.fixture()
def plan(atelier, monde):
    """Un plan neuf à la TV, la table ouverte, pions libres ; les files des deux joueurs vides, le journal effacé."""
    p = monde["creer"]("plans", **plan_d_essai(monde["aude"]["id"], monde["bertrand"]["id"]))
    with demandes.verrou(config.PROPOSITIONS):
        for j in ("lea_id", "basile_id"):
            demandes.fichier(config.PROPOSITIONS, monde[j]).unlink(missing_ok=True)
    joueurs.DEPLACEMENTS_FAITS.clear()
    atelier.delete(f"/api/seances/{monde['seance']['id']}/combat")
    assert atelier.put("/api/table-joueurs", json={"ouverte": True, "pions": "libres", "distance": 12, "distance_combat": 6, "entrer": True}).status_code == 200
    assert atelier.put("/api/table", json={"vue": "plan", "plan": p["id"], "style": "couleur"}).status_code == 200
    tv_etat.table_coin.tout_de_suite()
    yield p
    (config.DONNEES / mouvements.DOSSIER / f"{p['id']}.json").unlink(missing_ok=True)
    (config.DONNEES / mouvements.TOURS).unlink(missing_ok=True)


def table(coin) -> dict:
    return coin.get("/api/table").json()


def case_sur_la_table(coin, pion="t-aude"):
    r = table(coin)
    t = next((x for x in r["vue"]["plan"]["pions"] if x["id"] == pion), None)
    return list(dp.case_du_pion(t)) if t else None


def bouger(coin, vers, depuis=None, pion="t-aude", plan=None):
    r = table(coin)
    corps = {"plan": plan or r["vue"]["plan"]["id"], "pion": pion,
             "depuis": depuis or case_sur_la_table(coin, pion) or [0, 0], "vers": list(vers)}
    return coin.post("/api/demandes", json={"genre": dp.GENRE, "corps": corps})


def pas(monde, vers, joueur="lea"):
    """Un déplacement depuis le coin, appliqué par l'atelier, et la table du coin republiée (le pas suivant part de là)."""
    r = bouger(monde[joueur], vers)
    assert r.status_code == 200, r.text
    d = traitee(monde, joueur, r.json()["id"])
    if d["statut"] == "appliquee":
        assert attendre(lambda: case_sur_la_table(monde[joueur]) == list(vers), 2.0)
    return d


def demande(monde, joueur, ident):
    return demandes.trouver(demandes.lire(config.PROPOSITIONS, monde[f"{joueur}_id"]), ident)


def traitee(monde, joueur, ident):
    d = attendre(lambda: (lambda x: x if x and x["statut"] != demandes.A_APPLIQUER else None)(demande(monde, joueur, ident)))
    assert d, "l'atelier n'a pas traité la demande"
    return d


def fiche_plan(atelier, plan):
    return atelier.get(f"/api/plans/{plan['id']}").json()


def pion_du_plan(atelier, plan, ident="t-aude"):
    t = next(x for x in fiche_plan(atelier, plan)["pions"] if x["id"] == ident)
    return [t["x"], t["y"]]


def dans_la_boite(atelier, monde, joueur, ident):
    v = atelier.get("/api/demandes").json()
    return next((x for x in v["attente"] + v["historique"] if x["joueur"] == monde[f"{joueur}_id"] and x["id"] == ident), None)


def ecrire_tout_droit(monde, joueur, corps, statut=demandes.A_APPLIQUER):
    """Une demande écrite tout droit dans la file, comme un coin qui ne vérifierait rien."""
    d = demandes.nouvelle({"genre": dp.GENRE, "corps": corps})
    d["statut"] = statut
    with demandes.verrou(config.PROPOSITIONS):
        jid = monde[f"{joueur}_id"]
        demandes.ecrire(config.PROPOSITIONS, jid, [*demandes.lire(config.PROPOSITIONS, jid), d])
    return d


def test_la_table_publie_le_reglage_et_le_tour(atelier, monde, plan):
    r = table(monde["lea"])
    assert r["vue"]["regles"] == {"pions": "libres", "distance": 12, "distance_combat": 6, "entrer": True}
    assert (r["pion"], r["combat"], r["mon_tour"], r["debut"]) == ("t-aude", False, False, None)
    atelier.put("/api/table-joueurs", json={"pions": "figes", "distance": 3})
    assert table(monde["lea"])["vue"]["regles"]["pions"] == "figes" and table(monde["lea"])["vue"]["regles"]["distance"] == 3


def test_pions_libres_le_pion_va_puis_s_annule(atelier, monde, plan):
    avant = fiche_plan(atelier, plan)["modifie"]
    r = bouger(monde["lea"], [1, 3])
    assert r.status_code == 200, r.text
    assert r.json()["statut"] == "a-appliquer" and r.json()["statut_dit"] == "en route"
    d = traitee(monde, "lea", r.json()["id"])
    assert d["statut"] == "appliquee" and d["resultat"] == "Fait : 1 case."
    assert pion_du_plan(atelier, plan) == [1.5, 3.5]
    # Le coin le voit à sa nouvelle case dans la seconde (la table est republiée tout de suite après).
    assert attendre(lambda: case_sur_la_table(monde["lea"]) == [1, 3], 1.0)
    # Le mouvement est noté, versions d'avant et d'après comprises.
    journal = json.loads((config.DONNEES / mouvements.DOSSIER / f"{plan['id']}.json").read_text(encoding="utf-8"))
    m = journal[-1]
    assert (m["pion"], m["avant"], m["apres"], m["version_avant"], m["demande"]) == ("t-aude", [0.5, 2.5], [1.5, 3.5], avant, d["id"])
    assert m["version_apres"] == fiche_plan(atelier, plan)["modifie"] and m["version_apres"] > avant
    # La boîte le dit au MJ, avec « Annuler ».
    el = dans_la_boite(atelier, monde, "lea", d["id"])
    assert el["annulable"] and el["phrase"].startswith("Aude est allée à 1 case vers le sud")
    assert atelier.post(f"/api/demandes/{monde['lea_id']}/{d['id']}/annuler", json={"version": el["version"]}).status_code == 200
    assert pion_du_plan(atelier, plan) == [0.5, 2.5]
    assert demande(monde, "lea", d["id"])["resultat"] == "Votre MJ a remis votre pion à sa place."
    assert attendre(lambda: case_sur_la_table(monde["lea"]) == [0, 2], 1.0)


def test_plusieurs_pas_de_suite(atelier, monde, plan):
    for vers in ([1, 2], [1, 3], [2, 3]):
        r = bouger(monde["lea"], vers)
        assert r.status_code == 200, r.text
        assert traitee(monde, "lea", r.json()["id"])["statut"] == "appliquee"
        assert attendre(lambda: case_sur_la_table(monde["lea"]) == vers, 1.0)
    # Le fichier du joueur ne garde que les derniers déplacements clos.
    for _ in range(4):
        for vers in ([2, 2], [2, 3]):
            pas(monde, vers)
    clos = [d for d in demandes.lire(config.PROPOSITIONS, monde["lea_id"]) if d["genre"] == dp.GENRE]
    assert len(clos) <= joueurs.DEPLACEMENTS_GARDES + 1


def test_un_seul_deplacement_en_route(atelier, monde, plan):
    d = ecrire_tout_droit(monde, "lea", {"plan": table(monde["lea"])["vue"]["plan"]["id"], "pion": "t-aude", "depuis": [0, 2], "vers": [0, 3]})
    traitee(monde, "lea", d["id"])
    atelier.put("/api/table-joueurs", json={"pions": "a-valider"})
    tv_etat.table_coin.tout_de_suite()
    r1 = bouger(monde["lea"], [1, 3])
    r2 = bouger(monde["lea"], [1, 2])
    assert r1.json()["statut"] == r2.json()["statut"] == "en-attente"
    # La seconde case remplace la première, qui attendait encore le MJ.
    assert demande(monde, "lea", r1.json()["id"])["statut"] == "retiree"


def test_a_valider_le_mj_tranche(atelier, monde, plan):
    atelier.put("/api/table-joueurs", json={"pions": "a-valider"})
    tv_etat.table_coin.tout_de_suite()
    r = bouger(monde["lea"], [1, 3])
    assert r.status_code == 200 and r.json()["statut"] == "en-attente" and r.json()["statut_dit"] == "le MJ valide"
    time.sleep(0.5)
    assert pion_du_plan(atelier, plan) == [0.5, 2.5]
    # L'éditeur ouvert sur ce plan voit le pion fantôme.
    attente = atelier.get(f"/api/plans/{plan['id']}/deplacements").json()["attente"]
    assert [(x["pion"], x["vers"], x["joueur"]) for x in attente] == [("t-aude", [1, 3], monde["lea_id"])]
    assert attente[0]["phrase"] == "Aude veut aller à 1 case vers le sud-est."
    assert atelier.post(f"/api/demandes/{monde['lea_id']}/{r.json()['id']}/accepter", json={"version": attente[0]["version"]}).status_code == 200
    assert pion_du_plan(atelier, plan) == [1.5, 3.5]
    assert attendre(lambda: case_sur_la_table(monde["lea"]) == [1, 3], 1.0)
    assert atelier.get(f"/api/plans/{plan['id']}/deplacements").json()["attente"] == []
    # Refusé : rien ne bouge, le joueur lit le mot du MJ.
    r = bouger(monde["lea"], [2, 3])
    el = dans_la_boite(atelier, monde, "lea", r.json()["id"])
    assert atelier.post(f"/api/demandes/{monde['lea_id']}/{r.json()['id']}/refuser", json={"version": el["version"], "mot": "Pas encore."}).status_code == 200
    assert pion_du_plan(atelier, plan) == [1.5, 3.5]
    vue = next(x for x in monde["lea"].get("/api/demandes").json()["demandes"] if x["id"] == r.json()["id"])
    assert (vue["statut"], vue["mot"]) == ("refusee", "Pas encore.")
    # Le joueur peut retirer celle qui attend.
    r = bouger(monde["lea"], [2, 3])
    assert monde["lea"].delete(f"/api/demandes/{r.json()['id']}").status_code == 200
    assert atelier.get(f"/api/plans/{plan['id']}/deplacements").json()["attente"] == []


def test_a_valider_entre_temps_la_demande_libre_echoue(atelier, monde, plan):
    atelier.put("/api/table-joueurs", json={"pions": "a-valider"})
    d = ecrire_tout_droit(monde, "lea", {"plan": table(monde["lea"])["vue"]["plan"]["id"], "pion": "t-aude", "depuis": [0, 2], "vers": [0, 3]})
    d = traitee(monde, "lea", d["id"])
    assert d["statut"] == "echec" and d["resultat"] == mouvements.A_VALIDER
    assert pion_du_plan(atelier, plan) == [0.5, 2.5]


def test_figes_rien_ne_bouge(atelier, monde, plan):
    atelier.put("/api/table-joueurs", json={"pions": "figes"})
    tv_etat.table_coin.tout_de_suite()
    r = bouger(monde["lea"], [1, 3])
    assert r.status_code == 423 and r.json()["detail"] == dp.FIGES
    d = ecrire_tout_droit(monde, "lea", {"plan": table(monde["lea"])["vue"]["plan"]["id"], "pion": "t-aude", "depuis": [0, 2], "vers": [0, 3]})
    assert traitee(monde, "lea", d["id"])["resultat"] == dp.FIGES
    # Le MJ, lui, peut accepter même figés (son geste) : une demande en attente écrite avant le changement.
    d = ecrire_tout_droit(monde, "lea", {"plan": table(monde["lea"])["vue"]["plan"]["id"], "pion": "t-aude", "depuis": [0, 2], "vers": [0, 3]},
                          statut=demandes.EN_ATTENTE)
    el = attendre(lambda: dans_la_boite(atelier, monde, "lea", d["id"]))
    assert atelier.post(f"/api/demandes/{monde['lea_id']}/{d['id']}/accepter", json={"version": el["version"]}).status_code == 200
    assert pion_du_plan(atelier, plan) == [0.5, 3.5]


def test_en_pause_rien_ne_part(atelier, monde, plan):
    demandes.ecrire_pause(config.PROPOSITIONS, True)
    try:
        assert bouger(monde["lea"], [1, 3]).status_code == 423
    finally:
        demandes.ecrire_pause(config.PROPOSITIONS, False)


def test_entrer_revele_la_piece(atelier, monde, plan):
    # Par la porte ouverte du bas : (0, 2) → (3, 3) → (4, 3), la première case de la salle cachée.
    r = bouger(monde["lea"], [4, 3])
    assert r.status_code == 200, r.text
    d = traitee(monde, "lea", r.json()["id"])
    assert d["statut"] == "appliquee" and d["resultat"] == "Fait : 4 cases, et la pièce se révèle."
    p = fiche_plan(atelier, plan)
    assert all(p["brouillard"][y * W + x] == 1 for y in range(H) for x in range(W))
    assert attendre(lambda: "SALLE-CACHEE" in json.dumps(table(monde["lea"])), 1.0)
    m = json.loads((config.DONNEES / mouvements.DOSSIER / f"{plan['id']}.json").read_text(encoding="utf-8"))[-1]
    assert sorted(m["cases"]) == sorted(y * W + x for y in range(H) for x in range(4, W)) and m["brouillard"] == 1
    # « Annuler » remet le pion, et cache de nouveau la pièce.
    el = dans_la_boite(atelier, monde, "lea", d["id"])
    assert "Sa pièce s'est révélée" in el["phrase"]
    assert atelier.post(f"/api/demandes/{monde['lea_id']}/{d['id']}/annuler", json={"version": el["version"]}).status_code == 200
    p = fiche_plan(atelier, plan)
    assert pion_du_plan(atelier, plan) == [0.5, 2.5] and not any(p["brouillard"][y * W + x] for y in range(H) for x in range(4, W))


def test_sans_entrer_la_salle_cachee_reste_hors_d_atteinte(atelier, monde, plan):
    atelier.put("/api/table-joueurs", json={"entrer": False})
    tv_etat.table_coin.tout_de_suite()
    r = bouger(monde["lea"], [4, 3])
    assert r.status_code == 409 and r.json()["detail"] == dp.PAS_REVELEE


def test_fuite_une_porte_secrete_voisine_n_ouvre_rien(atelier, monde, plan):
    """La porte secrète non découverte, pourtant ouverte, en (4, 1), sur le mur entre les deux salles : ni le coin ni
    l'atelier n'y passent, et le refus est celui de tout mur vers le noir (lot E4 : NOIR, d'après la seule projection)."""
    r = bouger(monde["lea"], [4, 1])
    assert r.status_code == 409 and r.json()["detail"] == dp.NOIR
    d = ecrire_tout_droit(monde, "lea", {"plan": table(monde["lea"])["vue"]["plan"]["id"], "pion": "t-aude", "depuis": [0, 2], "vers": [4, 1]})
    d = traitee(monde, "lea", d["id"])
    assert d["statut"] == "echec" and d["resultat"] == dp.NOIR
    assert pion_du_plan(atelier, plan) == [0.5, 2.5]
    assert not any(fiche_plan(atelier, plan)["brouillard"][y * W + x] for y in range(H) for x in range(4, W))
    # Verrouillée, la porte du bas : le coin la voit fermée et laisse tenter ; l'atelier dit qu'elle est fermée à clé, sans
    # rien ouvrir ni rien révéler.
    p = fiche_plan(atelier, plan)
    p["portes"][1]["etat"] = "verrouillee"
    atelier.put(f"/api/plans/{plan['id']}", json=p)
    tv_etat.table_coin.tout_de_suite()
    r = bouger(monde["lea"], [4, 3])
    assert r.status_code == 200, r.text
    d = traitee(monde, "lea", r.json()["id"])
    assert d["statut"] == "echec" and d["resultat"] == dp.VERROUILLEE
    p = fiche_plan(atelier, plan)
    assert p["portes"][1]["etat"] == "verrouillee" and pion_du_plan(atelier, plan) == [0.5, 2.5]
    assert not any(p["brouillard"][y * W + x] for y in range(H) for x in range(4, W))
    # Fermée, elle s'ouvre : Aude entre, la salle se révèle.
    p["portes"][1]["etat"] = "fermee"
    atelier.put(f"/api/plans/{plan['id']}", json=p)
    tv_etat.table_coin.tout_de_suite()
    d = pas(monde, [4, 3])
    assert d["statut"] == "appliquee" and d["resultat"] == "Fait : 4 cases, une porte ouverte, et la pièce se révèle."
    p = fiche_plan(atelier, plan)
    assert p["portes"][1]["etat"] == "ouverte" and p["portes"][0]["etat"] == "ouverte" and p["portes"][0]["decouverte"] is False


def test_fuite_un_pion_cache_a_l_arrivee_ne_refuse_rien(atelier, monde, plan):
    r = bouger(monde["lea"], [2, 2])
    assert r.status_code == 200, r.text
    d = traitee(monde, "lea", r.json()["id"])
    assert d["statut"] == "appliquee" and d["resultat"] == "Fait : 2 cases."
    assert pion_du_plan(atelier, plan) == [2.5, 2.5]
    # Le MJ est prévenu, le joueur n'en sait rien.
    assert "EMBUSCADE-SECRETE" in dans_la_boite(atelier, monde, "lea", d["id"])["phrase"]
    for texte in (json.dumps(demandes.vue_joueur(d), ensure_ascii=False), monde["lea"].get("/api/demandes").text, monde["lea"].get("/api/table").text):
        for interdit in SECRETS:
            assert interdit not in texte, interdit


def test_un_pion_dans_le_noir_derriere_la_porte_previent_le_mj(atelier, monde, plan):
    """Le gobelin attend juste derrière la porte ouverte, dans la salle encore cachée : Aude y entre (rien ne le lui
    refuse, elle ne le voit pas), et le MJ est prévenu qu'un pion était sur la case, dans la boîte comme dans l'éditeur."""
    p = fiche_plan(atelier, plan)
    next(t for t in p["pions"] if t["id"] == "t-noir").update(x=4.5, y=3.5)
    assert atelier.put(f"/api/plans/{plan['id']}", json=p).status_code == 200
    tv_etat.table_coin.tout_de_suite()
    r = bouger(monde["lea"], [4, 3])
    assert r.status_code == 200, r.text
    d = traitee(monde, "lea", r.json()["id"])
    assert d["statut"] == "appliquee"
    assert "GOBELIN-DU-NOIR" in dans_la_boite(atelier, monde, "lea", d["id"])["phrase"]
    m = json.loads((config.DONNEES / mouvements.DOSSIER / f"{plan['id']}.json").read_text(encoding="utf-8"))[-1]
    assert any("GOBELIN-DU-NOIR" in a for a in m["alertes"])
    assert "GOBELIN-DU-NOIR" not in json.dumps(demandes.vue_joueur(d), ensure_ascii=False)
    # Un pion visible sur une case révélée ne fait rien dire : Bertrand, où Aude ne peut pas aller, n'est pas un secret.
    assert mouvements.caches_sur(fiche_plan(atelier, plan), {}, (2, 1)) == []


def test_fuite_aucun_refus_ne_dit_rien_de_cache(atelier, monde, plan):
    """Chaque case du plan essayée depuis le coin : aucun refus ne nomme ni ne trahit ce que le joueur ne voit pas, et la
    case d'un pion caché ne se distingue d'aucune autre."""
    phrases = set()
    for y in range(H):
        for x in range(W):
            r = bouger(monde["lea"], [x, y])
            if r.status_code == 200:
                # Une case permise : on la défait, pour essayer la suivante depuis la même place.
                traitee(monde, "lea", r.json()["id"])
                atelier.put("/api/table-joueurs", json={"pions": "libres"})
                p = fiche_plan(atelier, plan)
                next(t for t in p["pions"] if t["id"] == "t-aude").update(x=0.5, y=2.5)
                p["brouillard"] = grille({(i, j): 1 if i < 4 else 0 for j in range(H) for i in range(W)})
                p["portes"][1]["etat"] = "ouverte"
                atelier.put(f"/api/plans/{plan['id']}", json=p)
                tv_etat.table_coin.tout_de_suite()
                joueurs.DEPLACEMENTS_FAITS.clear()
                continue
            phrases.add(r.json()["detail"])
    assert phrases <= {dp.DEJA_LA, dp.PRISE, dp.MEUBLE, dp.NOIR, dp.SANS_PASSAGE_ENTRER}, phrases
    for texte in phrases:
        for interdit in SECRETS:
            assert interdit not in texte


def test_tour_usurpe(atelier, monde, plan):
    """Basile ne bouge pas le pion d'Aude, ni depuis le coin, ni par une demande écrite tout droit."""
    r = bouger(monde["basile"], [1, 3], depuis=[0, 2], pion="t-aude")
    assert r.status_code == 409 and r.json()["detail"] == dp.PAS_SUR_LE_PLAN
    d = ecrire_tout_droit(monde, "basile", {"plan": table(monde["basile"])["vue"]["plan"]["id"], "pion": "t-aude", "depuis": [0, 2], "vers": [1, 3]})
    assert traitee(monde, "basile", d["id"])["resultat"] == dp.PAS_SUR_LE_PLAN
    assert pion_du_plan(atelier, plan) == [0.5, 2.5]


def combat(atelier, monde, actif, tour=1, version=None):
    a, b = monde["aude"], monde["bertrand"]
    url = f"/api/seances/{monde['seance']['id']}/combat"
    actuel = atelier.get(url).json()["combat"]
    corps = {"id": "c1", "nom": "Combat des déplacements", "tour": tour, "actif": actif,
             "ordre": [f"aventurier:{a['id']}", "ennemis", f"aventurier:{b['id']}"],
             "heros": [{"id": a["id"], "nom": "Aude", "max": 9, "sante": 9}, {"id": b["id"], "nom": "Bertrand", "max": 8, "sante": 8}],
             "adversaires": [], "version_base": (actuel or {}).get("modifie")}
    r = atelier.put(url, json=corps)
    assert r.status_code == 200, r.text
    tv_etat.table_coin.tout_de_suite()


def test_en_combat_a_son_tour_seulement(atelier, monde, plan):
    combat(atelier, monde, actif=1)
    r = table(monde["lea"])
    assert (r["combat"], r["mon_tour"]) == (True, False)
    assert bouger(monde["lea"], [1, 3]).json()["detail"] == dp.PAS_TON_TOUR
    d = ecrire_tout_droit(monde, "lea", {"plan": r["vue"]["plan"]["id"], "pion": "t-aude", "depuis": [0, 2], "vers": [1, 3]})
    assert traitee(monde, "lea", d["id"])["resultat"] == dp.PAS_TON_TOUR
    # À son tour : sa case du début du tour est notée, publiée, et compte pour tout le tour.
    combat(atelier, monde, actif=0)
    r = table(monde["lea"])
    assert (r["combat"], r["mon_tour"], r["debut"]) == (True, True, [0, 2])
    atelier.put("/api/table-joueurs", json={"distance_combat": 3})
    tv_etat.table_coin.tout_de_suite()
    for vers in ([1, 3], [2, 3]):
        assert pas(monde, vers)["statut"] == "appliquee"
    # La distance du tour dépassée en plusieurs fois : (0, 2) → (3, 3) vaut 3, (0, 2) → (3, 2)… mais pas (3, 1) par le
    # garde, ni plus loin.
    pas(monde, [3, 3])
    r = bouger(monde["lea"], [4, 3])
    assert r.status_code == 409 and r.json()["detail"] == dp.trop_loin(3, True)
    # Revenir sur ses pas reste permis.
    assert pas(monde, [1, 2])["statut"] == "appliquee"
    # Le tour passe aux ennemis, puis revient à Aude au tour suivant : elle repart de sa case du moment.
    combat(atelier, monde, actif=1)
    assert bouger(monde["lea"], [1, 3]).json()["detail"] == dp.PAS_TON_TOUR
    combat(atelier, monde, actif=0, tour=2)
    assert table(monde["lea"])["debut"] == [1, 2]
    assert bouger(monde["lea"], [4, 3]).status_code == 200


def test_un_combat_perime_ne_compte_pas(atelier, monde, plan):
    """Une séance close garde son combat, Aude n'y a pas la main : hors de ce combat, elle bouge comme hors combat."""
    combat(atelier, monde, actif=1)
    s = atelier.get(f"/api/seances/{monde['seance']['id']}").json()
    s["close"] = True
    assert atelier.put(f"/api/seances/{s['id']}", json=s).status_code == 200
    try:
        tv_etat.table_coin.tout_de_suite()
        r = table(monde["lea"])
        assert (r["combat"], r["mon_tour"]) == (False, False)
        assert bouger(monde["lea"], [1, 3]).status_code == 200
    finally:
        s = atelier.get(f"/api/seances/{monde['seance']['id']}").json()
        s["close"] = False
        atelier.put(f"/api/seances/{s['id']}", json=s)


def test_le_pion_bouge_par_le_mj_entre_temps(atelier, monde, plan):
    """Le joueur a vu son pion en (0, 2) ; le MJ l'a mis ailleurs entre-temps : son geste gagne."""
    jeton = table(monde["lea"])["vue"]["plan"]["id"]
    p = fiche_plan(atelier, plan)
    next(t for t in p["pions"] if t["id"] == "t-aude").update(x=0.5, y=3.5)
    atelier.put(f"/api/plans/{plan['id']}", json=p)
    d = ecrire_tout_droit(monde, "lea", {"plan": jeton, "pion": "t-aude", "depuis": [0, 2], "vers": [1, 2]})
    assert traitee(monde, "lea", d["id"])["resultat"] == dp.A_BOUGE
    assert pion_du_plan(atelier, plan) == [0.5, 3.5]


def test_un_autre_plan_a_la_tv(atelier, monde, plan):
    jeton = table(monde["lea"])["vue"]["plan"]["id"]
    atelier.put("/api/table", json={"vue": "accueil"})
    tv_etat.table_coin.tout_de_suite()
    r = bouger(monde["lea"], [1, 3], depuis=[0, 2], plan=jeton)
    assert r.status_code == 409 and r.json()["detail"] == dp.PLUS_LA
    d = ecrire_tout_droit(monde, "lea", {"plan": jeton, "pion": "t-aude", "depuis": [0, 2], "vers": [1, 3]})
    assert traitee(monde, "lea", d["id"])["resultat"] == dp.PLUS_LA


# ---------------------------------------------------------------- l'éditeur du MJ en retard

def test_rejeu_l_editeur_en_retard_ne_perd_rien(atelier, monde, plan):
    """L'éditeur a lu le plan, un joueur bouge (deux fois), l'éditeur enregistre un changement à lui (un texte, un mur
    par une pièce retouchée) avec sa vieille version : tout reste, sans conflit."""
    ed = fiche_plan(atelier, plan)
    for vers in ([1, 2], [1, 3]):
        pas(monde, vers)
    ed["textes"] = [{"id": "x1", "texte": "Ici, le MJ écrit", "x": 1, "y": 1}]
    ed["piece"][0] = 2  # une case de A passe dans B : un mur de plus
    r = atelier.put(f"/api/plans/{plan['id']}", json={**ed, "version_base": ed["modifie"]})
    assert r.status_code == 200, r.text
    assert [m["apres"] for m in r.json()["rejoues"]] == [[1.5, 2.5], [1.5, 3.5]]
    p = fiche_plan(atelier, plan)
    assert pion_du_plan(atelier, plan) == [1.5, 3.5] and p["textes"][0]["texte"] == "Ici, le MJ écrit" and p["piece"][0] == 2
    assert "rejoues" not in p
    # L'éditeur, à jour, enregistre de nouveau sans rien rejouer.
    r = atelier.put(f"/api/plans/{plan['id']}", json={**p, "version_base": p["modifie"]})
    assert r.status_code == 200 and "rejoues" not in r.json()


def test_rejeu_le_meme_pion_bouge_des_deux_cotes(atelier, monde, plan):
    ed = fiche_plan(atelier, plan)
    pas(monde, [1, 3])
    next(t for t in ed["pions"] if t["id"] == "t-aude").update(x=3.5, y=3.5)
    r = atelier.put(f"/api/plans/{plan['id']}", json={**ed, "version_base": ed["modifie"]})
    assert r.status_code == 200
    assert pion_du_plan(atelier, plan) == [3.5, 3.5]  # le geste du MJ gagne


def test_rejeu_un_autre_ecran_entre_temps(atelier, monde, plan):
    """Un autre écran a enregistré le plan entre deux mouvements : le conflit d'avant reste le dernier recours."""
    ed = fiche_plan(atelier, plan)
    pas(monde, [1, 3])
    autre = fiche_plan(atelier, plan)
    autre["notes"] = "NOTE-AUTRE-ECRAN"
    assert atelier.put(f"/api/plans/{plan['id']}", json={**autre, "version_base": autre["modifie"]}).status_code == 200
    tv_etat.table_coin.tout_de_suite()
    pas(monde, [2, 3])
    assert atelier.put(f"/api/plans/{plan['id']}", json={**ed, "version_base": ed["modifie"]}).status_code == 409
    # Et une version qui n'a jamais existé non plus.
    assert atelier.put(f"/api/plans/{plan['id']}", json={**ed, "version_base": "1999-01-01T00:00:00.000"}).status_code == 409
    # Un plan redimensionné ne se rejoue pas.
    ed = fiche_plan(atelier, plan)
    pas(monde, [2, 2])
    plus_large = {**ed, "largeur": W + 1}
    assert atelier.put(f"/api/plans/{plan['id']}", json={**plus_large, "version_base": ed["modifie"]}).status_code == 409


def test_rejeu_d_une_annulation_et_de_la_piece_revelee(atelier, monde, plan):
    ed = fiche_plan(atelier, plan)
    d = pas(monde, [4, 3])
    ed_apres_entree = fiche_plan(atelier, plan)
    r = atelier.put(f"/api/plans/{plan['id']}", json={**ed, "version_base": ed["modifie"]})
    assert r.status_code == 200
    p = fiche_plan(atelier, plan)
    assert all(p["brouillard"][y * W + x] == 1 for y in range(H) for x in range(4, W)) and pion_du_plan(atelier, plan) == [4.5, 3.5]
    el = dans_la_boite(atelier, monde, "lea", d["id"])
    assert atelier.post(f"/api/demandes/{monde['lea_id']}/{d['id']}/annuler", json={"version": el["version"]}).status_code == 200
    # Un éditeur resté sur la version d'après l'entrée rejoue l'annulation : pion remis, pièce cachée.
    r = atelier.put(f"/api/plans/{plan['id']}", json={**ed_apres_entree, "version_base": p["modifie"]})
    assert r.status_code == 200, r.text
    p = fiche_plan(atelier, plan)
    assert pion_du_plan(atelier, plan) == [0.5, 2.5] and not any(p["brouillard"][y * W + x] for y in range(H) for x in range(4, W))


def test_les_pages_de_l_atelier_recoivent_le_mouvement(atelier, monde, plan):
    with atelier.websocket_connect("/ws/atelier") as ws:
        pas(monde, [1, 3])
        recu = None
        for _ in range(20):
            msg = ws.receive_json()
            if msg.get("type") == "plan":
                recu = msg
                break
        assert recu and recu["plan"] == plan["id"]
        m = recu["mouvements"][0]
        assert (m["pion"], m["avant"], m["apres"]) == ("t-aude", [0.5, 2.5], [1.5, 3.5]) and m["version_avant"] and m["version_apres"]


def test_le_coin_sert_ses_modules():
    for f in ("js/plan/deplacement.js", "js/joueurs/bouger.js", "css/bouger-coin.css"):
        assert f in joueurs.FICHIERS
    assert "js/plan/mouvements-joueurs.js" not in joueurs.FICHIERS and "js/plan/editeur.js" not in joueurs.FICHIERS


def test_le_patch_et_la_corbeille_des_plans_attendent_un_deplacement(atelier, monde, plan):
    """Un « Accepter » de la boîte pose le pion dans un autre fil, sous le verrou des mouvements : le PATCH d'un plan
    (« Poser les adversaires ») et sa mise à la corbeille l'attendent, au lieu d'écrire entre sa lecture et son écriture."""
    import threading
    tenu, lacher = threading.Event(), threading.Event()

    def tenir():
        with tv_etat.mouvements_joueurs.verrou:
            tenu.set()
            lacher.wait(5)

    for geste in ("patch", "delete"):
        tenu.clear()
        lacher.clear()
        t = threading.Thread(target=tenir)
        t.start()
        assert tenu.wait(2)
        fini = []
        if geste == "patch":
            u = threading.Thread(target=lambda: fini.append(atelier.patch(f"/api/plans/{plan['id']}", json={"notes": "PATCH"}).status_code))
        else:
            u = threading.Thread(target=lambda: fini.append(atelier.delete(f"/api/plans/{plan['id']}").status_code))
        u.start()
        time.sleep(0.4)
        assert not fini, f"le {geste} n'a pas attendu le verrou des mouvements"
        lacher.set()
        u.join(5)
        t.join(5)
        assert fini == [200]
    assert not (config.PLANS / f"{plan['id']}.json").exists()


def test_le_journal_des_mouvements_se_relit_seulement_quand_il_change(tmp_path):
    """La boîte dit chaque déplacement d'après le journal (du_journal, dans la boucle, à chaque passage) : tant que le fichier
    ne bouge pas, il n'est pas relu ; un mouvement noté se voit aussitôt."""
    m = mouvements.Mouvements(tmp_path, reglage=dict, plan_montre=lambda: None, plan_par_id=lambda _i: None, ecrire_plan=lambda *_: None,
                              projection=lambda *_: {}, heros_du_joueur=lambda _i: None, seances=list, diffuser=None, publier_coin=None,
                              signaler=None, maintenant=utilitaires.maintenant)
    assert m.lire_journal("p") == [] and m.du_journal("d1") is None
    m.noter("p", {"id": "m1", "demande": "d1", "genre": "joueur", "apres": [1.5, 1.5]})
    premier = m.lire_journal("p")
    assert m.lire_journal("p") is premier and m.du_journal("d1")["id"] == "m1"
    m.noter("p", {"id": "m2", "demande": "d2", "genre": "joueur", "apres": [2.5, 1.5]})
    assert [x["id"] for x in m.lire_journal("p")] == ["m1", "m2"] and m.du_journal("d2")["id"] == "m2"
    assert [x["id"] for x in premier] == ["m1"]


# ---------------------------------------------------------------- lot E4 : ouvrir les portes, un pas dans le noir

E4_SECRETS = ("SALLE-E4", "GOBELIN-E4", "EMBUSCADE-E4", "COFFRE-E4", "NOTE-E4", "secrete", "verrouillee", "decouverte")


def plan_de_lettres(aude: str, carte: list, depart: tuple, genres: dict | None = None, portes=(), pions=(), objets=(),
                    noms: dict | None = None) -> dict:
    """Un plan écrit comme les cas communs (outils/cas_deplacement.py) : une lettre par case, minuscule révélée, majuscule
    cachée, « # » pas de sol révélé, « % » pas de sol caché. Aude se tient sur depart."""
    h, w = len(carte), len(carte[0])
    sol, piece, vu = [], [], []
    for ligne in carte:
        for c in ligne:
            vide = c in "#%"
            sol.append(0 if vide else 2)
            piece.append(0 if vide else "abcdefghijklmnopqrstuvwxyz".index(c.lower()) + 1)
            vu.append(1 if c in "#" or (not vide and c.islower()) else 0)
    lettres = sorted({c.lower() for ligne in carte for c in ligne if c not in "#%"})
    pieces = [{"id": "abcdefghijklmnopqrstuvwxyz".index(c) + 1, "nom": (noms or {}).get(c, f"Pièce {c}"), "nom_visible": True,
               "genre": (genres or {}).get(c, "salle"), "notes": "NOTE-E4-PIECE"} for c in lettres]
    return {"nom": "Plan E4", "lieu": "", "largeur": w, "hauteur": h, "m_case": 1.5, "brouillard_actif": True, "notes": "NOTE-E4-PLAN",
            "style": "couleur", "sol": sol, "piece": piece, "brouillard": vu, "pieces": pieces, "portes": list(portes),
            "objets": list(objets), "textes": [],
            "pions": [{"id": "t-aude", "genre": "heros", "nom": "Aude", "ref": f"aventurier:{aude}", "x": depart[0] + 0.5, "y": depart[1] + 0.5},
                      *pions]}


@pytest.fixture()
def montrer(atelier, monde):
    """montrer(fiche) : ce plan à la TV, la table ouverte, pions libres, « entrer » coché ; les files vidées. Le journal et
    les tentatives effacés à la fin."""
    faits = []

    def f(fiche, **reglage):
        p = monde["creer"]("plans", **fiche)
        faits.append(p)
        with demandes.verrou(config.PROPOSITIONS):
            for j in ("lea_id", "basile_id"):
                demandes.fichier(config.PROPOSITIONS, monde[j]).unlink(missing_ok=True)
        joueurs.DEPLACEMENTS_FAITS.clear()
        atelier.delete(f"/api/seances/{monde['seance']['id']}/combat")
        assert atelier.put("/api/table-joueurs", json={"ouverte": True, "pions": "libres", "distance": 12, "distance_combat": 6,
                                                       "entrer": True, **reglage}).status_code == 200
        assert atelier.put("/api/table", json={"vue": "plan", "plan": p["id"], "style": "couleur"}).status_code == 200
        tv_etat.table_coin.tout_de_suite()
        return p

    yield f
    for p in faits:
        (config.DONNEES / mouvements.DOSSIER / f"{p['id']}.json").unlink(missing_ok=True)
    (config.DONNEES / mouvements.TENTATIVES).unlink(missing_ok=True)
    (config.DONNEES / mouvements.TOURS).unlink(missing_ok=True)


def porte_du_plan(atelier, plan, ident):
    return next(d for d in fiche_plan(atelier, plan)["portes"] if d["id"] == ident)


def revelees(atelier, plan) -> set:
    p = fiche_plan(atelier, plan)
    w = p["largeur"]
    return {(i % w, i // w) for i, v in enumerate(p["brouillard"]) if v == 1}


def ce_que_voit(coin) -> str:
    """Tout ce que le joueur peut lire : la table publiée et ses demandes."""
    return coin.get("/api/table").text + coin.get("/api/demandes").text


def test_e4_une_porte_fermee_s_ouvre_entre_deux_salles_revelees(atelier, monde, montrer):
    p = montrer(plan_de_lettres(monde["aude"]["id"], ["aaabbb", "aaabbb", "aaabbb"], (0, 1),
                                portes=[{"id": "porte-f", "sens": "v", "x": 3, "y": 1, "genre": "porte", "etat": "fermee"}]))
    # Le coin calcule la case derrière la porte comme une tentative (une porte à ouvrir).
    publie = table(monde["lea"])
    assert next(d for d in publie["vue"]["plan"]["portes"] if d["id"] == "porte-f")["etat"] == "fermee"
    d = pas(monde, [4, 1])
    assert d["statut"] == "appliquee" and d["resultat"] == "Fait : 4 cases, une porte ouverte."
    assert porte_du_plan(atelier, p, "porte-f")["etat"] == "ouverte" and pion_du_plan(atelier, p) == [4.5, 1.5]
    assert next(x for x in table(monde["lea"])["vue"]["plan"]["portes"] if x["id"] == "porte-f")["etat"] == "ouverte"
    m = json.loads((config.DONNEES / mouvements.DOSSIER / f"{p['id']}.json").read_text(encoding="utf-8"))[-1]
    assert m["portes"] == [{"sens": "v", "x": 3, "y": 1, "avant": "fermee", "apres": "ouverte"}] and m["cases"] == []
    el = dans_la_boite(atelier, monde, "lea", d["id"])
    assert "Elle ouvre une porte." in el["phrase"]
    # « Annuler » rend le pion et referme la porte.
    assert atelier.post(f"/api/demandes/{monde['lea_id']}/{d['id']}/annuler", json={"version": el["version"]}).status_code == 200
    assert porte_du_plan(atelier, p, "porte-f")["etat"] == "fermee" and pion_du_plan(atelier, p) == [0.5, 1.5]
    assert attendre(lambda: next(x for x in table(monde["lea"])["vue"]["plan"]["portes"] if x["id"] == "porte-f")["etat"] == "fermee", 1.0)


def test_e4_le_plus_court_chemin_qui_ouvre_le_moins_de_portes(atelier, monde, montrer):
    """Deux portes vers la même salle, à la même distance : l'ouverte sert, la fermée reste fermée."""
    p = montrer(plan_de_lettres(monde["aude"]["id"], ["aaabbb", "aaabbb", "aaabbb"], (0, 1),
                                portes=[{"id": "haut", "sens": "v", "x": 3, "y": 0, "genre": "porte", "etat": "fermee"},
                                        {"id": "bas", "sens": "v", "x": 3, "y": 2, "genre": "porte", "etat": "ouverte"}]))
    d = pas(monde, [5, 1])
    assert d["resultat"] == "Fait : 5 cases."
    assert porte_du_plan(atelier, p, "haut")["etat"] == "fermee"


def test_e4_entrer_par_une_porte_fermee_revele_la_piece(atelier, monde, montrer):
    """La salle cachée derrière une porte fermée : rien d'elle ne sort avant que le héros y entre ; après, la salle et ce
    qui s'y voit, mais ni le pion en embuscade, ni le coffre caché, ni la salle voisine encore cachée."""
    gobelin = {"id": "t-gob", "genre": "ennemi", "nom": "GOBELIN-E4", "court": "1", "x": 5.5, "y": 0.5}
    embuscade = {"id": "t-emb", "genre": "ennemi", "nom": "EMBUSCADE-E4", "court": "2", "x": 4.5, "y": 2.5, "cache": True}
    coffre = {"id": "o-coffre", "cle": "coffre", "x": 5, "y": 2, "l": 1, "h": 1, "cache": True, "nom": "COFFRE-E4"}
    voisine = {"id": "t-vois", "genre": "ennemi", "nom": "VOISIN-E4", "court": "3", "x": 7.5, "y": 1.5}
    p = montrer(plan_de_lettres(monde["aude"]["id"], ["aaaBBBCC", "aaaBBBCC", "aaaBBBCC"], (1, 1), noms={"b": "SALLE-E4", "c": "AUTRE-E4"},
                                portes=[{"id": "porte-b", "sens": "v", "x": 3, "y": 1, "genre": "porte", "etat": "fermee", "note": "NOTE-E4-PORTE"},
                                        {"id": "porte-c", "sens": "v", "x": 6, "y": 1, "genre": "porte", "etat": "fermee"}],
                                pions=[gobelin, embuscade, voisine], objets=[coffre]))
    avant = ce_que_voit(monde["lea"])
    for interdit in ("SALLE-E4", "GOBELIN-E4", "EMBUSCADE-E4", "COFFRE-E4", "AUTRE-E4", "VOISIN-E4", "NOTE-E4", "porte-c"):
        assert interdit not in avant, interdit
    d = pas(monde, [3, 1])
    assert d["resultat"] == "Fait : 2 cases, une porte ouverte, et la pièce se révèle."
    assert revelees(atelier, p) == {(x, y) for y in range(3) for x in range(6)}
    assert attendre(lambda: "SALLE-E4" in table(monde["lea"])["vue"]["plan"]["pieces"][-1]["nom"], 1.0)
    apres = ce_que_voit(monde["lea"])
    for interdit in ("EMBUSCADE-E4", "COFFRE-E4", "AUTRE-E4", "VOISIN-E4", "NOTE-E4", "t-emb", "o-coffre", "t-vois"):
        assert interdit not in apres, interdit
    # Le gobelin, debout dans la salle révélée, paraît, sans son nom (un adversaire n'a que son numéro).
    assert "t-gob" in apres and "GOBELIN-E4" not in apres
    # La porte de la salle voisine, sur le mur de la salle révélée, se voit fermée : rien de ce qu'il y a derrière.
    assert next(x for x in table(monde["lea"])["vue"]["plan"]["portes"] if x["id"] == "porte-c")["etat"] == "fermee"
    # « Annuler » referme la porte et cache de nouveau la salle.
    el = dans_la_boite(atelier, monde, "lea", d["id"])
    assert "Sa pièce s'est révélée." in el["phrase"] and "Elle ouvre une porte." in el["phrase"]
    assert atelier.post(f"/api/demandes/{monde['lea_id']}/{d['id']}/annuler", json={"version": el["version"]}).status_code == 200
    assert revelees(atelier, p) == {(x, y) for y in range(3) for x in range(3)}
    assert porte_du_plan(atelier, p, "porte-b")["etat"] == "fermee"
    assert attendre(lambda: "SALLE-E4" not in ce_que_voit(monde["lea"]), 1.0)


def test_e4_porte_verrouillee_rien_ne_s_ouvre(atelier, monde, montrer):
    p = montrer(plan_de_lettres(monde["aude"]["id"], ["aaaBBB", "aaaBBB", "aaaBBB"], (1, 1), noms={"b": "SALLE-E4"},
                                portes=[{"id": "porte-v", "sens": "v", "x": 3, "y": 1, "genre": "porte", "etat": "verrouillee"}]))
    # Le coin la voit fermée : il laisse tenter.
    assert next(x for x in table(monde["lea"])["vue"]["plan"]["portes"] if x["id"] == "porte-v")["etat"] == "fermee"
    r = bouger(monde["lea"], [3, 1])
    assert r.status_code == 200, r.text
    d = traitee(monde, "lea", r.json()["id"])
    assert (d["statut"], d["resultat"]) == ("echec", dp.VERROUILLEE)
    assert porte_du_plan(atelier, p, "porte-v")["etat"] == "verrouillee" and pion_du_plan(atelier, p) == [1.5, 1.5]
    assert revelees(atelier, p) == {(x, y) for y in range(3) for x in range(3)}
    assert "SALLE-E4" not in ce_que_voit(monde["lea"])
    # Le MJ apprend ce qui l'a arrêtée, dans la boîte et dans l'éditeur ; le joueur n'a que sa phrase. Dans la boîte, la
    # raison du refus le dit, la phrase ne le redit pas (une ligne en double, vague 6).
    el = dans_la_boite(atelier, monde, "lea", d["id"])
    assert el["resultat"] == dp.VERROUILLEE and "fermée à clé" not in el["phrase"]
    t = atelier.get(f"/api/plans/{p['id']}/deplacements").json()["tentatives"]
    assert [(x["id"], x["raison"]) for x in t] == [(d["id"], "verrouillee")]
    # Le MJ ne l'accepte pas non plus d'un geste : à valider, son « Accepter » se heurte à la même serrure.
    atelier.put("/api/table-joueurs", json={"pions": "a-valider"})
    tv_etat.table_coin.tout_de_suite()
    r = bouger(monde["lea"], [3, 1])
    assert r.json()["statut"] == "en-attente"
    el = attendre(lambda: dans_la_boite(atelier, monde, "lea", r.json()["id"]))
    rep = atelier.post(f"/api/demandes/{monde['lea_id']}/{r.json()['id']}/accepter", json={"version": el["version"]})
    assert rep.status_code == 409 and rep.json()["detail"] == dp.VERROUILLEE
    assert porte_du_plan(atelier, p, "porte-v")["etat"] == "verrouillee"


def vue_sans_dates(d: dict) -> dict:
    v = demandes.vue_joueur(d)
    for k in ("id", "cree", "modifie", "traitee"):
        v.pop(k, None)
    v["corps"] = {k: x for k, x in v["corps"].items() if k != "plan"}
    return v


def table_sans_jeton(coin) -> str:
    """La table que lit le joueur, sans ce qui change d'un plan à l'autre sans rien dire de lui : son jeton, l'heure de la
    publication, la signature de sa version."""
    r = table(coin)
    jeton = r["vue"]["plan"]["id"]
    r["vue"].pop("maj", None)
    r["vue"]["plan"].pop("modifie", None)
    return json.dumps(r, sort_keys=True, ensure_ascii=False).replace(jeton, "JETON")


def essai_complet(atelier, monde, montrer, fiche, vers) -> dict:
    """Le même geste, de bout en bout : ce que lit le joueur de sa table, de la réponse du coin, de sa demande traitée par
    l'atelier (écrite par le coin, puis écrite tout droit comme un coin qui ne vérifierait rien), et le temps pris."""
    p = montrer(fiche)
    res = {"plan": p, "table": table_sans_jeton(monde["lea"])}
    debut = time.monotonic()
    r = bouger(monde["lea"], vers)
    res["coin"] = (r.status_code, sorted(r.json()), r.json().get("detail") or r.json().get("statut"), r.json().get("statut_dit"))
    if r.status_code == 200:
        d = traitee(monde, "lea", r.json()["id"])
        res["duree"] = time.monotonic() - debut
        res["demande"] = vue_sans_dates(d)
        # Ce que le MJ en lit (la boîte, l'éditeur) : à part, jamais comparé à ce que lit le joueur.
        res["boite"] = dans_la_boite(atelier, monde, "lea", d["id"])["phrase"]
        res["tentatives"] = [x["raison"] for x in atelier.get(f"/api/plans/{p['id']}/deplacements").json()["tentatives"]]
    joueurs.DEPLACEMENTS_FAITS.clear()
    d = ecrire_tout_droit(monde, "lea", {"plan": table(monde["lea"])["vue"]["plan"]["id"], "pion": "t-aude",
                                        "depuis": case_sur_la_table(monde["lea"]), "vers": list(vers)})
    debut = time.monotonic()
    d = traitee(monde, "lea", d["id"])
    res["duree_tout_droit"] = time.monotonic() - debut
    res["tout_droit"] = vue_sans_dates(d)
    res["apres"] = table_sans_jeton(monde["lea"])
    res["demandes"] = [{k: v for k, v in x.items() if k not in ("id", "cree", "modifie", "traitee", "corps")}
                       for x in monde["lea"].get("/api/demandes").json()["demandes"]]
    res["fiche"] = fiche_plan(atelier, p)
    return res


def test_fuite_e4_une_porte_secrete_se_refuse_comme_un_mur(atelier, monde, montrer):
    """Le cœur du lot : une arête où se cache une porte secrète non découverte (même ouverte) et la même arête avec un mur
    répondent pareil en tout, au coin comme dans ce que le joueur relit de sa demande : phrase, statut, code, champs,
    ordre de grandeur du temps. Deux situations : sur le mur entre deux salles (le coin refuse, d'après la projection,
    identique), puis là où le plan n'a pas de mur (une cour qui continue dans le noir) : la projection y dessine un mur
    (tv_plans.murs_des_secretes), comme celui d'une salle cachée accolée à la cour, et le coin refuse pareil. Puis, à part, la
    cour qui s'arrête (pas de sol) : rien ne le montre, le coin laisse tenter, l'atelier refuse avec MUR."""
    secrete = {"id": "porte-s", "sens": "v", "x": 3, "y": 1, "genre": "secrete", "etat": "ouverte", "decouverte": False, "note": "NOTE-E4-SECRETE"}
    for carte, genres, mur, avec in (
            # Sur un mur : la salle cachée derrière la porte secrète, ou derrière un mur plein.
            (["aaaBBB", "aaaBBB", "aaaBBB"], None, None, [secrete]),
            # Sans mur : la cour continue dans le noir derrière la porte secrète ; à côté, une salle cachée accolée à la cour
            # (le mur de sa façade).
            (["aaaAAA", "aaaAAA", "aaaAAA"], {"a": "exterieur"}, ["aaaAAA", "aaaBAA", "aaaAAA"], [secrete])):
        a = essai_complet(atelier, monde, montrer, plan_de_lettres(monde["aude"]["id"], mur or carte, (2, 1), genres=genres), [3, 1])
        b = essai_complet(atelier, monde, montrer, plan_de_lettres(monde["aude"]["id"], carte, (2, 1), genres=genres, portes=avec), [3, 1])
        for cle in ("table", "coin", "demande", "tout_droit", "apres", "demandes"):
            assert a.get(cle) == b.get(cle), (cle, a.get(cle), b.get(cle))
        assert a["coin"][0] == 409 and a["coin"][2] == dp.NOIR and a["tout_droit"]["resultat"] == dp.NOIR
        assert abs(a["duree_tout_droit"] - b["duree_tout_droit"]) < 1.0
        # Rien n'a bougé : la porte secrète reste secrète et ouverte, le pion à sa place, rien de révélé.
        porte = next(d for d in b["fiche"]["portes"] if d["id"] == "porte-s")
        assert (porte["etat"], porte["decouverte"]) == ("ouverte", False)
        assert next(t for t in b["fiche"]["pions"] if t["id"] == "t-aude")["x"] == 2.5
        for texte in (b["table"], b["apres"], json.dumps(b["demandes"], ensure_ascii=False), json.dumps(b["tout_droit"], ensure_ascii=False)):
            for interdit in E4_SECRETS:
                assert interdit not in texte, interdit
    # La cour qui s'arrête dans le noir (pas de sol) : rien ne le montre, le coin laisse tenter, l'atelier refuse avec MUR,
    # dans le temps d'une vague ; le MJ sait pourquoi.
    a = essai_complet(atelier, monde, montrer, plan_de_lettres(monde["aude"]["id"], ["aaa%%%", "aaa%%%", "aaa%%%"], (2, 1),
                                                               genres={"a": "exterieur"}), [3, 1])
    assert a["coin"][0] == 200 and a["demande"]["statut"] == "echec" and a["demande"]["resultat"] == dp.MUR
    assert a["tout_droit"]["resultat"] == dp.MUR and a["duree"] < 3
    assert "pas de sol" in a["boite"] and a["tentatives"][:1] == ["mur"]


def test_fuite_e4_une_porte_secrete_hors_d_un_mur_se_dessine_en_mur(atelier, monde, montrer):
    """Une porte secrète posée là où le plan n'a pas de mur, les deux côtés révélés (un couloir d'une seule pièce) : la
    projection la dessine en mur, exactement les bits d'un mur entre deux salles ; le coin refuse comme pour un mur, et rien
    ne part vers l'atelier. Sans cela, l'atelier aurait refusé (« Un mur vous arrête ») là où la TV ne montre rien, ou un
    détour aurait allongé le chemin sans raison visible."""
    secrete = {"id": "porte-s", "sens": "v", "x": 2, "y": 1, "genre": "secrete", "etat": "fermee", "decouverte": False, "note": "NOTE-E4-SECRETE"}
    montrer(plan_de_lettres(monde["aude"]["id"], ["#####", "aaaaa", "#####"], (0, 1), portes=[secrete]))
    avec = table(monde["lea"])["vue"]["plan"]
    r = bouger(monde["lea"], [3, 1])
    assert (r.status_code, r.json()["detail"]) == (409, dp.SANS_PASSAGE_ENTRER)
    assert not demandes.lire(config.PROPOSITIONS, monde["lea_id"])
    montrer(plan_de_lettres(monde["aude"]["id"], ["#####", "aabbb", "#####"], (0, 1)))
    mur = table(monde["lea"])["vue"]["plan"]
    assert avec["murs"] == mur["murs"] and avec["portes"] == mur["portes"] == []
    assert bouger(monde["lea"], [3, 1]).json()["detail"] == dp.SANS_PASSAGE_ENTRER
    for interdit in E4_SECRETS:
        assert interdit not in json.dumps(avec, ensure_ascii=False), interdit
    # Découverte, elle redevient une porte : plus de mur (les murs du couloir sans porte), elle s'ouvre en passant.
    montrer(plan_de_lettres(monde["aude"]["id"], ["#####", "aaaaa", "#####"], (0, 1)))
    sans = table(monde["lea"])["vue"]["plan"]["murs"]
    assert sans != avec["murs"]
    montrer(plan_de_lettres(monde["aude"]["id"], ["#####", "aaaaa", "#####"], (0, 1), portes=[secrete | {"decouverte": True}]))
    vue = table(monde["lea"])["vue"]["plan"]
    assert [d["genre"] for d in vue["portes"]] == ["porte"] and vue["murs"] == sans
    assert pas(monde, [3, 1])["resultat"] == "Fait : 3 cases, une porte ouverte."
    # Dans une salle ouverte, un pan de portes secrètes : le chemin que compte le coin est celui que fait l'atelier.
    pan = [{"id": f"s{y}", "sens": "v", "x": 1, "y": y, "genre": "secrete", "etat": "fermee", "decouverte": False} for y in (0, 1, 2)]
    montrer(plan_de_lettres(monde["aude"]["id"], ["aaa", "aaa", "aaa", "aaa"], (0, 0), portes=pan))
    vu = table(monde["lea"])["vue"]
    attendu = dp.verifier(vu["plan"], {"pion": "t-aude", "depuis": [0, 0], "vers": [2, 0]}, vu["regles"], {"combat": False})["distance"]
    assert attendu > 2
    assert pas(monde, [2, 0])["resultat"] == f"Fait : {attendu} cases."


def test_les_murs_des_portes_secretes():
    """tv_plans.murs_des_secretes : un mur droit, une paroi dans une grotte ; rien pour une porte découverte, ni sur un mur déjà
    là (les plans d'avant gardent leurs murs à l'identique)."""
    def plan(carte, genres=None, portes=()):
        return plan_de_lettres("x", carte, (0, 0), genres=genres, portes=portes)

    def secrete(sens, x, y, **plus):
        return {"id": "s", "sens": sens, "x": x, "y": y, "genre": "secrete", "etat": "fermee", "decouverte": False} | plus

    p = plan(["aaaa"], portes=[secrete("v", 2, 0)])
    m = tv_plans.murs_du_plan(p)
    assert tv_plans.murs_des_secretes(p, m) == [m[0], m[1] | 2, m[2] | 8, m[3]]
    p = plan(["aaaa"], genres={"a": "grotte"}, portes=[secrete("v", 2, 0)])
    m = tv_plans.murs_du_plan(p)
    assert tv_plans.murs_des_secretes(p, m) == [m[0], m[1] | 32, m[2] | 128, m[3]]
    p = plan(["a", "a"], genres={"a": "exterieur"}, portes=[secrete("h", 0, 1)])
    assert tv_plans.murs_des_secretes(p, tv_plans.murs_du_plan(p)) == [4, 1]
    for p in (plan(["aaaa"], portes=[secrete("v", 2, 0, decouverte=True)]), plan(["aabb"], portes=[secrete("v", 2, 0)]),
              plan(["aaaa"], portes=[{"id": "p", "sens": "v", "x": 2, "y": 0, "genre": "porte", "etat": "fermee"}]),
              plan(["a#aa"], portes=[secrete("v", 2, 0)])):
        assert tv_plans.murs_des_secretes(p, tv_plans.murs_du_plan(p)) == tv_plans.murs_du_plan(p)


def test_e4_un_seul_pas_dans_le_noir_d_une_grotte(atelier, monde, montrer):
    """Une grotte à moitié révélée : un pas dans le noir révèle les cases de la grotte à deux cases au plus du héros, rien de
    plus ; un héros ne vise pas deux cases dans le noir, ni en forgeant sa requête."""
    gobelin = {"id": "t-gob", "genre": "ennemi", "nom": "GOBELIN-E4", "court": "1", "x": 6.5, "y": 1.5}
    embuscade = {"id": "t-emb", "genre": "ennemi", "nom": "EMBUSCADE-E4", "court": "2", "x": 4.5, "y": 0.5, "cache": True}
    coffre = {"id": "o-coffre", "cle": "coffre", "x": 5, "y": 2, "l": 1, "h": 1, "cache": True}
    p = montrer(plan_de_lettres(monde["aude"]["id"], ["aaaAAAA", "aaaAAAA", "aaaAAAA"], (1, 1), genres={"a": "grotte"},
                                pions=[gobelin, embuscade], objets=[coffre]))
    r = bouger(monde["lea"], [4, 1])
    assert r.status_code == 409 and r.json()["detail"] == dp.NOIR
    d = ecrire_tout_droit(monde, "lea", {"plan": table(monde["lea"])["vue"]["plan"]["id"], "pion": "t-aude", "depuis": [1, 1], "vers": [4, 1]})
    assert traitee(monde, "lea", d["id"])["resultat"] == dp.NOIR
    d = pas(monde, [3, 1])
    assert d["resultat"] == "Fait : 2 cases, et les alentours se révèlent."
    assert revelees(atelier, p) == {(x, y) for y in range(3) for x in range(6)}
    vu = ce_que_voit(monde["lea"])
    for interdit in ("t-gob", "t-emb", "o-coffre", "GOBELIN-E4", "EMBUSCADE-E4", "NOTE-E4"):
        assert interdit not in vu, interdit
    assert "Ses alentours se sont révélés." in dans_la_boite(atelier, monde, "lea", d["id"])["phrase"]
    # Le pas suivant : (6, 1) est désormais à un pas du connu. Le gobelin y attend dans le noir : rien ne le refuse au
    # joueur, le MJ est prévenu.
    d = pas(monde, [6, 1])
    assert d["statut"] == "appliquee" and "GOBELIN-E4" in dans_la_boite(atelier, monde, "lea", d["id"])["phrase"]
    assert "GOBELIN-E4" not in json.dumps(demandes.vue_joueur(d), ensure_ascii=False)


def test_e4_une_cour_ne_se_revele_jamais_d_un_pas(atelier, monde, montrer):
    p = montrer(plan_de_lettres(monde["aude"]["id"], ["aaBBBBBBBB"] * 5, (1, 2), genres={"a": "exterieur", "b": "exterieur"}))
    d = pas(monde, [2, 2])
    assert d["resultat"] == "Fait : 1 case, et les alentours se révèlent."
    nouvelles = revelees(atelier, p) - {(x, y) for y in range(5) for x in range(2)}
    assert nouvelles == {(x, y) for y in range(5) for x in range(2, 5)}


def test_e4_sans_entrer_ni_porte_ni_noir_et_jamais_une_porte_secrete(atelier, monde, montrer):
    """« Entrer » décoché : une porte fermée barre la route, le noir reste hors d'atteinte. Et même là, une porte secrète
    posée sans mur ne se traverse pas : la projection la dessine en mur, le coin la refuse comme un mur, et une demande
    écrite tout droit (un coin qui ne vérifierait rien) se heurte au même refus dans l'atelier."""
    montrer(plan_de_lettres(monde["aude"]["id"], ["aaabbbAA"], (0, 0), genres={"a": "exterieur", "b": "exterieur"},
                            portes=[{"id": "f", "sens": "v", "x": 3, "y": 0, "genre": "porte", "etat": "fermee"}]), entrer=False)
    assert bouger(monde["lea"], [3, 0]).json()["detail"] == dp.SANS_PASSAGE
    assert bouger(monde["lea"], [6, 0]).json()["detail"] == dp.PAS_REVELEE
    p = montrer(plan_de_lettres(monde["aude"]["id"], ["aaaaaa"], (0, 0), genres={"a": "exterieur"},
                                portes=[{"id": "s", "sens": "v", "x": 3, "y": 0, "genre": "secrete", "etat": "ouverte", "decouverte": False}]),
                entrer=False)
    r = bouger(monde["lea"], [5, 0])
    assert (r.status_code, r.json()["detail"]) == (409, dp.SANS_PASSAGE)
    d = traitee(monde, "lea", ecrire_tout_droit(monde, "lea", {"plan": table(monde["lea"])["vue"]["plan"]["id"], "pion": "t-aude",
                                                                 "depuis": [0, 0], "vers": [5, 0]})["id"])
    assert (d["statut"], d["resultat"]) == ("echec", dp.SANS_PASSAGE) and pion_du_plan(atelier, p) == [0.5, 0.5]


def test_e4_une_fenetre_jamais(atelier, monde, montrer):
    montrer(plan_de_lettres(monde["aude"]["id"], ["aaaBBB"], (2, 0), portes=[{"id": "fe", "sens": "v", "x": 3, "y": 0, "genre": "fenetre", "etat": "ouverte"}]))
    assert bouger(monde["lea"], [3, 0]).json()["detail"] == dp.NOIR
    d = ecrire_tout_droit(monde, "lea", {"plan": table(monde["lea"])["vue"]["plan"]["id"], "pion": "t-aude", "depuis": [2, 0], "vers": [3, 0]})
    assert traitee(monde, "lea", d["id"])["resultat"] == dp.NOIR


def test_e4_une_porte_sur_le_vide_reste_une_sortie(atelier, monde, montrer):
    """Comme avant le lot E4 : une porte qui donne sur une case sans sol mène le pion hors de la vue, le MJ prévenu."""
    p = montrer(plan_de_lettres(monde["aude"]["id"], ["aaa%"], (2, 0), portes=[{"id": "sortie", "sens": "v", "x": 3, "y": 0, "genre": "porte", "etat": "fermee"}]))
    d = traitee(monde, "lea", bouger(monde["lea"], [3, 0]).json()["id"])
    assert d["statut"] == "appliquee" and porte_du_plan(atelier, p, "sortie")["etat"] == "ouverte"
    assert "sans sol" in dans_la_boite(atelier, monde, "lea", d["id"])["phrase"]


def test_e4_rejeu_l_editeur_en_retard_ouvre_aussi_la_porte(atelier, monde, montrer):
    p = montrer(plan_de_lettres(monde["aude"]["id"], ["aaaBBB", "aaaBBB"], (0, 0),
                                portes=[{"id": "porte-b", "sens": "v", "x": 3, "y": 0, "genre": "porte", "etat": "fermee"},
                                        {"id": "autre", "sens": "v", "x": 3, "y": 1, "genre": "porte", "etat": "fermee"}]))
    ed = fiche_plan(atelier, p)
    pas(monde, [3, 0])
    # L'éditeur, en retard, a verrouillé l'autre porte de son côté : tout se garde.
    next(d for d in ed["portes"] if d["id"] == "autre")["etat"] = "verrouillee"
    r = atelier.put(f"/api/plans/{p['id']}", json={**ed, "version_base": ed["modifie"]})
    assert r.status_code == 200, r.text
    assert r.json()["rejoues"][0]["portes"] == [{"sens": "v", "x": 3, "y": 0, "avant": "fermee", "apres": "ouverte"}]
    assert porte_du_plan(atelier, p, "porte-b")["etat"] == "ouverte" and porte_du_plan(atelier, p, "autre")["etat"] == "verrouillee"
    assert (3, 1) in revelees(atelier, p) and pion_du_plan(atelier, p) == [3.5, 0.5]
    # Un éditeur en retard où le MJ a verrouillé la porte même que le héros vient d'ouvrir : son geste gagne, le pion passe.
    p = montrer(plan_de_lettres(monde["aude"]["id"], ["aaabbb"], (2, 0),
                                portes=[{"id": "porte-b", "sens": "v", "x": 3, "y": 0, "genre": "porte", "etat": "fermee"}]))
    ed = fiche_plan(atelier, p)
    d = pas(monde, [4, 0])
    assert d["statut"] == "appliquee" and porte_du_plan(atelier, p, "porte-b")["etat"] == "ouverte"
    next(x for x in ed["portes"] if x["id"] == "porte-b")["etat"] = "verrouillee"
    r = atelier.put(f"/api/plans/{p['id']}", json={**ed, "version_base": ed["modifie"]})
    assert r.status_code == 200 and r.json()["rejoues"]
    assert porte_du_plan(atelier, p, "porte-b")["etat"] == "verrouillee" and pion_du_plan(atelier, p) == [4.5, 0.5]


def test_e4_annuler_laisse_ce_que_le_mj_a_change(atelier, monde, montrer):
    p = montrer(plan_de_lettres(monde["aude"]["id"], ["aaaBBB", "aaaBBB"], (2, 0),
                                portes=[{"id": "porte-b", "sens": "v", "x": 3, "y": 0, "genre": "porte", "etat": "fermee"}]))
    d = pas(monde, [3, 0])
    # Le MJ verrouille la porte derrière Aude, et recache lui-même une case de la salle.
    f = fiche_plan(atelier, p)
    next(x for x in f["portes"] if x["id"] == "porte-b")["etat"] = "verrouillee"
    f["brouillard"][1 * 6 + 5] = 0
    assert atelier.put(f"/api/plans/{p['id']}", json={**f, "version_base": f["modifie"]}).status_code == 200
    el = dans_la_boite(atelier, monde, "lea", d["id"])
    assert atelier.post(f"/api/demandes/{monde['lea_id']}/{d['id']}/annuler", json={"version": el["version"]}).status_code == 200
    assert porte_du_plan(atelier, p, "porte-b")["etat"] == "verrouillee" and pion_du_plan(atelier, p) == [2.5, 0.5]
    assert revelees(atelier, p) == {(x, y) for y in range(2) for x in range(3)}


def test_e4_les_pages_de_l_atelier_recoivent_la_porte(atelier, monde, montrer):
    p = montrer(plan_de_lettres(monde["aude"]["id"], ["aaabbb"], (2, 0), portes=[{"id": "porte-b", "sens": "v", "x": 3, "y": 0, "genre": "porte", "etat": "fermee"}]))
    with atelier.websocket_connect("/ws/atelier") as ws:
        pas(monde, [3, 0])
        recu = None
        for _ in range(20):
            msg = ws.receive_json()
            if msg.get("type") == "plan":
                recu = msg
                break
    assert recu and recu["plan"] == p["id"]
    assert recu["mouvements"][0]["portes"] == [{"sens": "v", "x": 3, "y": 0, "avant": "fermee", "apres": "ouverte"}]


def test_e4_ce_qui_se_revele(tmp_path):
    """La règle de révélation (mouvements.a_reveler), sans serveur."""
    def fiche(carte, genres=None, portes=()):
        f = plan_de_lettres("x", carte, (0, 0), genres=genres, portes=portes)
        return f
    # Une salle entièrement cachée : toute la salle.
    f = fiche(["aaBBBB", "aaBBBB"])
    cases, comment = mouvements.a_reveler(f, (2, 0))
    assert comment == "piece" and sorted(cases) == sorted(y * 6 + x for y in range(2) for x in range(2, 6))
    # Une grotte entièrement cachée aussi.
    assert mouvements.a_reveler(fiche(["aaBBBB"], {"b": "grotte"}), (2, 0))[1] == "piece"
    # Une salle déjà entamée : deux cases autour, pas plus.
    f = fiche(["aaaAAAAA"])
    cases, comment = mouvements.a_reveler(f, (3, 0))
    assert comment == "autour" and cases == [3, 4, 5]
    # Une cour, même entièrement cachée : autour seulement.
    assert mouvements.a_reveler(fiche(["aaBBBBBB"], {"a": "exterieur", "b": "exterieur"}), (2, 0)) == ([2, 3, 4], "autour")
    # Jamais à travers une porte fermée, même dans la même pièce ; une porte ouverte laisse voir.
    portes = [{"id": "p", "sens": "v", "x": 4, "y": 0, "genre": "porte", "etat": "fermee"}]
    assert mouvements.a_reveler(fiche(["aaaAAAAA"], portes=portes), (3, 0)) == ([3], "autour")
    portes[0]["etat"] = "ouverte"
    assert mouvements.a_reveler(fiche(["aaaAAAAA"], portes=portes), (3, 0)) == ([3, 4, 5], "autour")
    # Ni une autre pièce, ni de l'autre côté d'un trou.
    assert mouvements.a_reveler(fiche(["aaaA%A"]), (3, 0)) == ([3], "autour")
    assert mouvements.a_reveler(fiche(["aaaABB"], {"a": "exterieur", "b": "exterieur"}), (3, 0)) == ([3], "autour")
    # Rien sur une case sans sol, déjà révélée, ou sans brouillard.
    assert mouvements.a_reveler(fiche(["aa%"]), (2, 0)) == ([], None)
    assert mouvements.a_reveler(fiche(["aaa"]), (1, 0)) == ([], None)
    assert mouvements.a_reveler({**fiche(["aaAA"]), "brouillard_actif": False}, (2, 0)) == ([], None)


def test_e4_l_eau_profonde_et_la_falaise_d_un_exterieur(atelier, monde, montrer):
    """Les plans extérieurs : l'eau profonde révélée se refuse au coin (sa phrase) ; cachée, rien ne la montre, le
    coin laisse tenter le pas dans le noir et l'atelier le refuse comme un mur, sans rien révéler ; le MJ sait que c'était
    de l'eau. Sous un pont, le même pas passe et révèle les alentours."""
    def rive(cachee, objets=()):
        fiche = plan_de_lettres(monde["aude"]["id"], ["aaaAAA" if cachee else "aaaaaa"] * 3, (2, 1), genres={"a": "exterieur"},
                                objets=objets)
        for y in range(3):
            fiche["sol"][y * 6 + 3] = 23
        fiche["sol"][5] = 24
        return fiche
    p = montrer(rive(False))
    r = bouger(monde["lea"], [3, 1])
    assert r.status_code == 409 and r.json()["detail"] == dp.INFRANCHISSABLE
    r = bouger(monde["lea"], [4, 1])
    assert r.status_code == 409 and r.json()["detail"] == dp.SANS_PASSAGE_ENTRER
    a = essai_complet(atelier, monde, montrer, rive(True), [3, 1])
    assert a["coin"][0] == 200 and a["demande"]["statut"] == "echec" and a["demande"]["resultat"] == dp.MUR
    assert a["tout_droit"]["resultat"] == dp.MUR and a["duree"] < 3
    assert a["tentatives"][:1] == ["infranchissable"] and "eau profonde" in a["boite"]
    assert next(t for t in a["fiche"]["pions"] if t["id"] == "t-aude")["x"] == 2.5
    assert revelees(atelier, a["plan"]) == {(x, y) for y in range(3) for x in range(3)}
    for interdit in ("eau profonde", "falaise", "infranchissable"):
        assert interdit not in a["apres"] and interdit not in json.dumps(a["demandes"], ensure_ascii=False)
    pont = {"id": "o-pont", "cle": "pont", "x": 3, "y": 0, "l": 1, "h": 3, "rot": 0}
    p = montrer(rive(True, [pont]))
    d = pas(monde, [3, 1])
    assert d["statut"] == "appliquee" and d["resultat"] == "Fait : 1 case, et les alentours se révèlent."
    assert pion_du_plan(atelier, p)[0] == 3.5


def test_e4_une_porte_qui_donne_sur_l_eau_profonde_cachee(atelier, monde, montrer):
    """Une cabane tracée par le MJ, dont la porte fermée donne sur l'eau profonde encore cachée : le héros n'y pose pas le
    pied (il ne s'y tiendrait pas), la porte reste fermée, rien ne se révèle ; refusé comme un mur, comme sans porte. Sous
    une barque, le même pas passe."""
    def cabane(objets=()):
        fiche = plan_de_lettres(monde["aude"]["id"], ["aaBBB", "aaBBB", "aaBBB"], (1, 1), genres={"a": "salle", "b": "exterieur"},
                                portes=[{"id": "porte-eau", "sens": "v", "x": 2, "y": 1, "genre": "porte", "etat": "fermee"}],
                                objets=objets)
        for y in range(3):
            fiche["sol"][y * 5 + 2] = 23
        return fiche
    a = essai_complet(atelier, monde, montrer, cabane(), [2, 1])
    assert a["coin"][0] == 200 and a["demande"]["statut"] == "echec" and a["demande"]["resultat"] == dp.MUR
    assert a["tout_droit"]["resultat"] == dp.MUR
    assert a["tentatives"][:1] == ["infranchissable"]
    assert next(t for t in a["fiche"]["pions"] if t["id"] == "t-aude")["x"] == 1.5
    assert porte_du_plan(atelier, a["plan"], "porte-eau")["etat"] == "fermee"
    assert revelees(atelier, a["plan"]) == {(x, y) for y in range(3) for x in range(2)}
    for interdit in ("eau profonde", "falaise", "infranchissable"):
        assert interdit not in a["apres"] and interdit not in json.dumps(a["demandes"], ensure_ascii=False)
    p = montrer(cabane([{"id": "o-barque", "cle": "barque", "x": 2, "y": 1, "l": 1, "h": 1, "rot": 0}]))
    d = pas(monde, [2, 1])
    assert d["statut"] == "appliquee" and pion_du_plan(atelier, p) == [2.5, 1.5]


# ---------------------------------------------------------------- les familiers (19/11)

@pytest.fixture()
def plan_familier(atelier, monde):
    """Le plan d'essai, avec Lumi, le familier d'Aude (ref « familier:<Aude> »), en (1, 1)."""
    fiche = plan_d_essai(monde["aude"]["id"], monde["bertrand"]["id"])
    fiche["pions"].append({"id": "t-lumi", "genre": "autre", "nom": "Lumi", "ref": f"familier:{monde['aude']['id']}", "x": 1.5, "y": 1.5})
    p = monde["creer"]("plans", **fiche)
    with demandes.verrou(config.PROPOSITIONS):
        for j in ("lea_id", "basile_id"):
            demandes.fichier(config.PROPOSITIONS, monde[j]).unlink(missing_ok=True)
    joueurs.DEPLACEMENTS_FAITS.clear()
    atelier.delete(f"/api/seances/{monde['seance']['id']}/combat")
    assert atelier.put("/api/table-joueurs", json={"ouverte": True, "pions": "libres", "distance": 12, "distance_combat": 6, "entrer": True}).status_code == 200
    assert atelier.put("/api/table", json={"vue": "plan", "plan": p["id"], "style": "couleur"}).status_code == 200
    tv_etat.table_coin.tout_de_suite()
    yield p
    (config.DONNEES / mouvements.DOSSIER / f"{p['id']}.json").unlink(missing_ok=True)
    (config.DONNEES / mouvements.TOURS).unlink(missing_ok=True)


def test_le_joueur_bouge_son_familier(atelier, monde, plan_familier):
    r = table(monde["lea"])
    assert r["pion"] == "t-aude" and r["familiers"] == [{"id": "t-lumi", "debut": None}]
    assert table(monde["basile"])["familiers"] == []
    # Le familier sur la table du coin : son nom, ni sa référence ni son héros.
    lumi = next(t for t in r["vue"]["plan"]["pions"] if t["id"] == "t-lumi")
    assert lumi["nom"] == "Lumi" and "ref" not in lumi
    d = bouger(monde["lea"], [1, 3], pion="t-lumi")
    assert d.status_code == 200, d.text
    assert traitee(monde, "lea", d.json()["id"])["statut"] == "appliquee"
    assert pion_du_plan(atelier, plan_familier, "t-lumi") == [1.5, 3.5]
    assert pion_du_plan(atelier, plan_familier, "t-aude") == [0.5, 2.5]
    # Basile ne bouge pas le familier d'Aude, ni depuis le coin, ni par une demande écrite tout droit.
    r = bouger(monde["basile"], [1, 2], pion="t-lumi")
    assert r.status_code == 409 and r.json()["detail"] == dp.PAS_SUR_LE_PLAN
    x = ecrire_tout_droit(monde, "basile", {"plan": table(monde["basile"])["vue"]["plan"]["id"], "pion": "t-lumi", "depuis": [1, 3], "vers": [1, 2]})
    assert traitee(monde, "basile", x["id"])["resultat"] == dp.PAS_SUR_LE_PLAN
    assert pion_du_plan(atelier, plan_familier, "t-lumi") == [1.5, 3.5]


def test_le_familier_bouge_au_tour_de_son_heros(atelier, monde, plan_familier):
    combat(atelier, monde, actif=1)
    assert bouger(monde["lea"], [1, 2], pion="t-lumi").json()["detail"] == dp.PAS_TON_TOUR
    combat(atelier, monde, actif=0)
    r = table(monde["lea"])
    # Chacun sa case du début du tour : le héros en (0, 2), Lumi en (1, 1).
    assert r["debut"] == [0, 2] and r["familiers"] == [{"id": "t-lumi", "debut": [1, 1]}]
    atelier.put("/api/table-joueurs", json={"distance_combat": 1})
    tv_etat.table_coin.tout_de_suite()
    d = bouger(monde["lea"], [1, 2], pion="t-lumi")
    assert d.status_code == 200 and traitee(monde, "lea", d.json()["id"])["statut"] == "appliquee"
    assert attendre(lambda: case_sur_la_table(monde["lea"], "t-lumi") == [1, 2], 2.0)
    # Sa distance se compte depuis sa propre case de début (1, 1) : (1, 3) est à deux cases, trop loin pour ce tour.
    r = bouger(monde["lea"], [1, 3], pion="t-lumi")
    assert r.status_code == 409 and r.json()["detail"] == dp.trop_loin(1, True)
    # Le héros garde la sienne : (0, 2) → (0, 3), une case.
    assert pas(monde, [0, 3])["statut"] == "appliquee"
