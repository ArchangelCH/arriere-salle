"""L'état de son héros réglé par le joueur depuis la table du coin : Santé, Psy et posture, appliqués tout de suite
par l'atelier, hors combat (l'état des héros, la fiche pour la posture) comme en combat (dans le combat, écrit comme par un
autre écran) ; l'avantage dépensé pour un test en combat ; et ce qui ne doit pas passer : une valeur forgée, le héros d'un
autre, une note du MJ.

Le monde et ses aides sont ceux de test_vague_g_c4_e4.py (Léa joue Aude, Basile joue Bertrand, Santé 9, Psy 5)."""
import json

import pytest

from test_vague_g_c4_e4 import (Hasard, atelier, attendre, combat, lancer, lecteurs, monde, neuf, traitee)  # noqa: F401
from api import actions_coin, config, heros_etat, tv_etat
from commun import demandes
from commun import etat_joueur as ej
import joueurs


@pytest.fixture()
def propre(atelier, neuf):
    """Chaque essai part de héros en pleine forme, posture focus, sans plafond horaire entamé."""
    for code in ("lea", "basile"):
        h = neuf[f"heros_{code}"]["id"]
        atelier.patch(f"/api/etats-heros/{h}", json={"sante": None, "psy": None, "santeDon": None, "notes": None})
        heros_etat.change_par_son_joueur(h, {"posture": "focus"})
    joueurs.ETATS_REGLES.clear()
    actions_coin.jets_mj.publier()
    yield neuf
    for code in ("lea", "basile"):
        atelier.patch(f"/api/etats-heros/{neuf[f'heros_{code}']['id']}", json={"sante": None, "psy": None, "santeDon": None, "notes": None})


def regler(m, code, **corps):
    r = m[code].post("/api/etat-heros", json=corps)
    assert r.status_code == 200, r.text
    return traitee(m, code, r.json()["regle"])


def vue(m, code):
    return m[code].get("/api/etat-heros").json()


def etat(h):
    return heros_etat.etats_heros().get(h) or {}


def test_le_calcul_et_ses_bornes():
    v = ej.vitalite(9, None, 5, None, None)
    assert v == {"sante": 9, "sante_max": 9, "psy": 5, "psy_max": 5, "sante_don": 0}
    assert ej.calculer(v, "sante", -3)["sante"] == 6 and ej.calculer(v, "sante", 5)["sante"] == 9
    # La mort : l'opposé du maximum, 10 au moins.
    assert ej.calculer(v, "sante", -99)["sante"] == -10 and ej.calculer(ej.vitalite(14, 2, 0, 0, 0), "sante", -99)["sante"] == -14
    assert ej.calculer(v, "psy", -9)["psy"] == 0 and ej.calculer(v, "psy", 9)["psy"] == 5
    # La Santé payée faute de Psy ne se soigne pas : deux points payés, le soin s'arrête à 7.
    paye = ej.vitalite(9, 4, 5, 0, 2)
    assert ej.calculer(paye, "sante", 9)["sante"] == 7 and ej.calculer(paye, "sante", 1)["sante"] == 5
    # Un état rangé : la Santé jamais au-dessus du maximum, la Psy dans ses bornes, des nombres illisibles au maximum.
    assert ej.vitalite(9, 30, 5, -4, "x") == {"sante": 9, "sante_max": 9, "psy": 0, "psy_max": 5, "sante_don": 0}
    for corps in ({"champ": "sante", "delta": 0}, {"champ": "sante", "delta": 100}, {"champ": "or", "delta": 1}, {"champ": "sante", "delta": 1.5},
                  {"champ": "sante", "delta": True}, {"champ": "sante", "delta": 1, "valeur": 9}, {"posture": "berserk"},
                  {"posture": "focus", "champ": "sante", "delta": 1}, {"sante": 9}, "sante", None, []):
        with pytest.raises(demandes.Refus):
            ej.valider(corps)
    assert ej.valider({"champ": "psy", "delta": -2}) == {"champ": "psy", "delta": -2} and ej.valider({"posture": "offensive"}) == {"posture": "offensive"}


def test_sante_et_psy_hors_combat(atelier, propre):
    m = propre
    aude = m["heros_lea"]["id"]
    assert attendre(lambda: vue(m, "lea")["heros"] and vue(m, "lea")["heros"]["vitalite"]["sante"] == 9)
    d = regler(m, "lea", champ="sante", delta=-3)
    assert d["statut"] == "appliquee" and d["resultat"] == "Santé : 9 → 6 (sur 9)."
    assert d["public"] == {"vitalite": {"sante": 6, "sante_max": 9, "psy": 5, "psy_max": 5, "sante_don": 0}, "posture": "focus", "combat": False}
    assert etat(aude)["sante"] == 6
    # La page relit aussitôt : le dernier geste, puis la fiche republiée.
    assert vue(m, "lea")["dernier"]["public"]["vitalite"]["sante"] == 6
    assert attendre(lambda: vue(m, "lea")["heros"]["vitalite"]["sante"] == 6)
    # Le MJ lit la même chose dans son Tableau.
    assert atelier.get("/api/etats-heros").json()["etats"][aude]["sante"] == 6
    # Un soin s'arrête au maximum : le champ repart de l'état (en pleine forme, rien n'est écrit).
    assert regler(m, "lea", champ="sante", delta=50)["resultat"] == "Santé : 6 → 9 (sur 9)."
    assert "sante" not in etat(aude)
    # La Psy, bornée à 0 et à son maximum.
    assert regler(m, "lea", champ="psy", delta=-2)["public"]["vitalite"]["psy"] == 3 and etat(aude)["psy"] == 3
    assert regler(m, "lea", champ="psy", delta=-20)["public"]["vitalite"]["psy"] == 0
    assert regler(m, "lea", champ="psy", delta=20)["public"]["vitalite"]["psy"] == 5 and "psy" not in etat(aude)
    # Le héros de l'autre joueur n'a pas bougé.
    assert etat(m["heros_basile"]["id"]) == {}
    # Chaque geste est au journal.
    lignes = [json.loads(x) for x in (config.DONNEES / "journal-etats.jsonl").read_text(encoding="utf-8").splitlines()]
    assert {"joueur": m["lea_id"], "heros": aude, "quoi": "sante", "avant": 9, "apres": 6, "combat": False}.items() <= lignes[-5].items()


def test_la_sante_payee_en_dons_et_la_note_du_mj(atelier, propre):
    m = propre
    aude = m["heros_lea"]["id"]
    assert atelier.patch(f"/api/etats-heros/{aude}", json={"sante": 4, "santeDon": 2, "notes": "NOTE-SECRETE-DU-MJ"}).status_code == 200
    assert attendre(lambda: vue(m, "lea")["heros"]["vitalite"] == {"sante": 4, "sante_max": 9, "psy": 5, "psy_max": 5, "sante_don": 2})
    d = regler(m, "lea", champ="sante", delta=9)
    assert d["public"]["vitalite"]["sante"] == 7 and etat(aude)["sante"] == 7 and etat(aude)["santeDon"] == 2
    # La note du MJ reste à lui : ni dans le geste, ni dans la page, ni dans ce que le coin a sur son disque.
    assert etat(aude)["notes"] == "NOTE-SECRETE-DU-MJ"
    assert "NOTE-SECRETE" not in json.dumps(d) + m["lea"].get("/api/etat-heros").text + m["lea"].get("/api/jets").text
    assert not any("NOTE-SECRETE" in f.read_text(encoding="utf-8", errors="replace") for f in config.PROPOSITIONS.rglob("*.json"))
    v = vue(m, "lea")
    assert set(v) == {"ouvert", "pause", "heros", "postures", "delta_max", "en_route", "dernier"}
    assert set(v["heros"]) == {"nom", "vitalite", "posture", "jeton", "combat"}


def test_la_posture_hors_combat(atelier, propre):
    m = propre
    aude = m["heros_lea"]["id"]
    avant = atelier.get(f"/api/aventuriers/{aude}").json()
    d = regler(m, "lea", posture="offensive")
    assert d["resultat"] == "Posture : offensive." and d["public"]["posture"] == "offensive"
    apres = atelier.get(f"/api/aventuriers/{aude}").json()
    assert apres["posture"] == "offensive" and apres["modifie"] != avant["modifie"]
    assert {k: v for k, v in apres.items() if k not in ("posture", "modifie")} == {k: v for k, v in avant.items() if k not in ("posture", "modifie")}
    assert attendre(lambda: vue(m, "lea")["heros"]["posture"] == "offensive")
    # La même posture : rien ne s'écrit.
    regler(m, "lea", posture="offensive")
    assert atelier.get(f"/api/aventuriers/{aude}").json()["modifie"] == apres["modifie"]


def test_ce_qui_est_refuse(atelier, propre, monkeypatch):
    m = propre
    for corps in ({"champ": "sante", "delta": 0}, {"champ": "sante", "delta": 100}, {"champ": "or", "delta": 5}, {"posture": "berserk"},
                  {"champ": "sante", "delta": 1, "sante": 99}, {"sante": 99}):
        assert m["lea"].post("/api/etat-heros", json=corps).status_code == 400, corps
    # Ni par la route commune des demandes, ni sans session.
    r = m["lea"].post("/api/demandes", json={"genre": ej.GENRE, "corps": {"champ": "sante", "delta": 9}})
    assert r.status_code == 409
    from fastapi.testclient import TestClient
    assert TestClient(joueurs.app).post("/api/etat-heros", json={"champ": "sante", "delta": -1}).status_code == 401
    assert TestClient(joueurs.app).get("/api/etat-heros").status_code == 401
    # Le plafond horaire.
    monkeypatch.setattr(ej, "PAR_HEURE", 2)
    joueurs.ETATS_REGLES.clear()
    codes = [m["lea"].post("/api/etat-heros", json={"champ": "psy", "delta": -1}).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    # Table du coin fermée : rien ne part.
    monkeypatch.setattr(ej, "PAR_HEURE", 240)
    assert atelier.put("/api/table-joueurs", json={"ouverte": False, "pions": "libres", "distance": 12, "distance_combat": 6, "entrer": True}).status_code == 200
    assert attendre(lambda: vue(m, "lea")["ouvert"] is False and vue(m, "lea")["heros"] is None)
    r = m["lea"].post("/api/etat-heros", json={"champ": "sante", "delta": -1})
    assert r.status_code == 409 and r.json()["detail"] == ej.FERMEE


def test_un_geste_forge_dans_la_file_passe_par_les_bornes_de_l_atelier(atelier, propre):
    """Le coin compromis écrit tout droit dans la file : l'atelier revalide, et ne lit jamais une valeur."""
    m = propre
    aude = m["heros_lea"]["id"]
    with demandes.verrou(config.PROPOSITIONS):
        liste = demandes.lire(config.PROPOSITIONS, m["lea_id"])
        d = demandes.nouvelle({"genre": ej.GENRE, "corps": {"champ": "sante", "delta": 50}})
        d["corps"] = {"champ": "sante", "delta": 5000, "sante_max": 999}
        demandes.ecrire(config.PROPOSITIONS, m["lea_id"], [*liste, d])
    fait = traitee(m, "lea", d["id"])
    assert fait["statut"] == "echec" and etat(aude) == {}


def test_en_combat_le_geste_s_ecrit_dans_le_combat(atelier, propre, monkeypatch):
    m = propre
    bertrand = m["heros_basile"]["id"]
    url = f"/api/seances/{m['seance']['id']}/combat"
    combat(atelier, m, 0, [{"id": bertrand, "nom": "Bertrand", "max": 9, "sante": 9, "posture": "focus", "avantage": "avantage"}])
    avant = atelier.get(url).json()["combat"]
    signaux = []
    vrai = tv_etat.diffusion.signaler_combat

    async def signaler(seance, c):
        signaux.append((seance, (c or {}).get("modifie"), (c or {}).get("par")))
        await vrai(seance, c)
    monkeypatch.setattr(tv_etat.diffusion, "signaler_combat", signaler)
    assert attendre(lambda: vue(m, "basile")["heros"]["combat"] is True)
    d = regler(m, "basile", champ="sante", delta=-4)
    assert d["resultat"] == "Santé : 9 → 5 (sur 9)." and d["public"]["combat"] is True
    c = atelier.get(url).json()["combat"]
    h = c["heros"][0]
    # Écrit comme par un autre écran : la version du combat monte, « par » le dit, le reste du combat n'a pas bougé.
    assert h["sante"] == 5 and c["par"] == "joueur" and c["modifie"] != avant["modifie"]
    assert {k: v for k, v in c.items() if k not in ("heros", "modifie", "par")} == {k: v for k, v in avant.items() if k not in ("heros", "modifie", "par")}
    # L'état des héros suit le combat, et l'écran du MJ est prévenu.
    assert etat(bertrand)["sante"] == 5
    assert attendre(lambda: (m["seance"]["id"], c["modifie"], "joueur") in signaux)
    # L'écran du MJ resté sur l'ancienne version ne l'écrase pas : 409, il relit et fusionne.
    assert atelier.put(url, json={**avant, "version_base": avant["modifie"]}).status_code == 409
    # La Psy d'un combat qui ne la suivait pas encore : posée avec son maximum, celui de la fiche.
    regler(m, "basile", champ="psy", delta=-2)
    h = atelier.get(url).json()["combat"]["heros"][0]
    assert (h["psy"], h["psyMax"]) == (3, 5) and etat(bertrand)["psy"] == 3
    # La posture du combat, pas celle de la fiche.
    assert regler(m, "basile", posture="defensive")["public"]["posture"] == "defensive"
    assert atelier.get(url).json()["combat"]["heros"][0]["posture"] == "defensive"
    assert atelier.get(f"/api/aventuriers/{bertrand}").json()["posture"] == "focus"
    assert heros_etat.postures_au_combat()[bertrand] == "defensive"
    # Sans posture (cassée par un dé de mésaventure) : à découvert, au combat aussi.
    assert regler(m, "basile", posture="aucune")["public"]["posture"] == "aucune"
    assert atelier.get(url).json()["combat"]["heros"][0]["posture"] == "aucune"
    assert heros_etat.postures_au_combat()[bertrand] == "aucune"
    regler(m, "basile", posture="defensive")
    # L'avantage dépensé pour un test, en combat : +10 %, le jeton quitte le combat et l'état.
    assert attendre(lambda: m["basile"].get("/api/jets").json()["heros"]["jeton"] == "avantage")
    actions_coin.jets_mj.hasard = Hasard(40)
    j = lancer(m, "basile", carac="physique", avantage=True)
    assert j["public"]["visee"] == 60 and {"libelle": "Avantage", "valeur": 10} in j["public"]["ajustements"]
    h = atelier.get(url).json()["combat"]["heros"][0]
    assert h["avantage"] == "" and etat(bertrand).get("avantage") is None
    # Le MJ reprend la main avec la dernière version : son écriture passe, et garde ce que le joueur a noté.
    c = atelier.get(url).json()["combat"]
    r = atelier.put(url, json={**c, "tour": 2, "par": "atelier", "version_base": c["modifie"]})
    assert r.status_code == 200 and r.json()["combat"]["heros"][0]["sante"] == 5
    # Le combat fini, l'état garde ce qui s'y est passé.
    assert atelier.delete(url).status_code == 200
    assert etat(bertrand)["sante"] == 5 and etat(bertrand)["psy"] == 3


def test_l_atelier_recoit_la_ligne_du_geste_jamais_la_tv(atelier, propre, monkeypatch):
    m = propre
    recus, tele = [], []
    vrai = tv_etat.diffusion.vers_atelier

    async def vers_atelier(message, pour=None):
        recus.append(message)
        await vrai(message, pour)

    async def envoyer(ecrans, message):
        tele.append(message)
    monkeypatch.setattr(tv_etat.diffusion, "vers_atelier", vers_atelier)
    monkeypatch.setattr(tv_etat.diffusion, "envoyer", envoyer)
    regler(m, "lea", champ="sante", delta=-2)
    ligne = attendre(lambda: next((x for x in recus if x.get("type") == "etat-joueur"), None))
    assert ligne == {"type": "etat-joueur", "joueur": "Léa", "heros": "Aude Vaguesix", "heros_id": m["heros_lea"]["id"], "quoi": "sante",
                     "avant": 9, "apres": 7, "combat": False}
    assert not any(x.get("type") == "etat-joueur" for x in tele)
    # Un geste sans effet (déjà au maximum) ne dérange pas le MJ.
    recus.clear()
    regler(m, "lea", champ="psy", delta=3)
    assert not any(x.get("type") == "etat-joueur" for x in recus)


def test_aucune_posture_aussi_hors_combat(atelier, propre):
    m = propre
    aude = m["heros_lea"]["id"]
    assert vue(m, "lea")["postures"] == {"offensive": "Offensive", "defensive": "Défensive", "focus": "Focus", "aucune": "Aucune"}
    # Hors combat, le joueur retire sa posture (choix du MJ du 19/11) : « Aucune » s'écrit sur la fiche, puis il en reprend une.
    d = regler(m, "lea", posture="aucune")
    assert d["statut"] != "echec", d
    assert atelier.get(f"/api/aventuriers/{aude}").json()["posture"] == "aucune"
    regler(m, "lea", posture="focus")
    assert atelier.get(f"/api/aventuriers/{aude}").json()["posture"] == "focus"
