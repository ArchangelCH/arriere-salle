"""Les dés libres et la réserve des dés d'aventure, en fonctions pures (lot G, des.py, reserve.py) : la lecture de « 2D6+1 »
et ses bornes (les cas communs avec la page, tests/des-cas.json), le tirage, les effets du D6 d'aventure, et les gestes de
la réserve qui gardent le total."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402

from commun import demandes  # noqa: E402
from commun import des  # noqa: E402
from contenu import reserve as rsv  # noqa: E402

CAS = json.loads((Path(__file__).parent / "des-cas.json").read_text(encoding="utf-8"))


class Hasard:
    def __init__(self, *faces):
        self.faces = list(faces)
        self.i = 0

    def randbelow(self, n):
        f = self.faces[self.i % len(self.faces)]
        self.i += 1
        return min(f, n) - 1


# ---------------------------------------------------------------- lire, borner, lancer

def test_les_cas_communs_avec_la_page():
    """Les mêmes cas que outils/verifier_des.mjs passe à js/jets/des.js : la page et le serveur lisent la même chose."""
    for texte, attendu in CAS["expressions"]:
        lu = des.lire(texte)
        assert (lu["texte"] if lu else None) == attendu, texte
    assert {int(k): v for k, v in CAS["effets"].items()} == des.EFFETS


@pytest.mark.parametrize("texte", ["1D6", "5D100+20", "5D100-20", "1D4"])
def test_les_bornes_tiennent(texte):
    lu = des.lire(texte)
    assert 1 <= lu["nombre"] <= des.NOMBRE_MAX and lu["faces"] in des.FACES and abs(lu["bonus"]) <= des.BONUS_MAX


def test_juste_au_dela_des_bornes():
    assert des.lire(f"{des.NOMBRE_MAX}D6") and not des.lire(f"{des.NOMBRE_MAX + 1}D6")
    assert des.lire(f"1D6+{des.BONUS_MAX}") and not des.lire(f"1D6+{des.BONUS_MAX + 1}")
    assert des.lire(f"1D6-{des.BONUS_MAX}") and not des.lire(f"1D6-{des.BONUS_MAX + 1}")
    for faces in (4, 6, 8, 10, 12, 20, 100):
        assert des.lire(f"1D{faces}")["faces"] == faces
    for faces in (1, 2, 3, 5, 7, 16, 30, 1000):
        assert des.lire(f"1D{faces}") is None, faces
    # Rien qui ne soit un texte, ni un texte trop long.
    for v in (None, 6, 2.5, ["1D6"], {"des": "1D6"}, True, "1D6" + " " * 40):
        assert des.lire(v) is None, v


def test_le_tirage():
    lu = des.lire("3D6-2")
    r = des.lancer(lu, Hasard(6, 1, 4))
    assert r == {"texte": "3D6-2", "nombre": 3, "faces": 6, "bonus": -2, "des": [6, 1, 4], "total": 9}
    # Un hasard qui rendrait trop haut est borné à la face : jamais plus que le dé.
    assert des.lancer(des.lire("2D4"), Hasard(99))["des"] == [4, 4]
    # Le hasard du serveur reste dans le dé, et un bonus négatif peut mener sous zéro (le choix du joueur).
    for _ in range(300):
        r = des.lancer(des.lire("5D100+20"))
        assert all(1 <= x <= 100 for x in r["des"]) and r["total"] == sum(r["des"]) + 20
    assert des.lancer(des.lire("1D4-20"), Hasard(1))["total"] == -19


def test_le_d6_d_aventure():
    assert [des.effet(f) for f in range(1, 7)] == ["Mouvement", "Mouvement", "Posture", "Posture", "In extremis", "In extremis"]
    assert des.effet(0) == "" and des.effet(7) == ""
    assert [des.face(v) for v in (1, 6, 0, 7, 3.0, True, "3", None)] == [1, 6, None, None, None, None, None, None]
    assert all(1 <= des.rouler_d6() <= 6 for _ in range(200))


# ---------------------------------------------------------------- la réserve

def neuve(**k):
    return rsv.normaliser({"actif": True, "groupe": 4, "mj": 0, **k})


def test_une_reserve_absente_ou_abimee():
    assert rsv.normaliser(None) == {"actif": False, "groupe": 4, "mj": 0, "mesaventures": {}}
    assert rsv.normaliser({"actif": "oui", "groupe": -3, "mj": 99, "mesaventures": {"../x": {"id": "a"}, "lea": "x"}}) == {
        "actif": False, "groupe": 0, "mj": 0, "mesaventures": {}}
    m = rsv.normaliser({"actif": True, "groupe": 3, "mj": 1, "mesaventures": {"lea": {"id": "abc", "heros": "ysolde", "face": 9, "pose": "t"}}})
    assert m["mesaventures"]["lea"]["face"] is None
    assert rsv.publique(m) == {"aventure": 3, "mesaventure": 1}
    assert rsv.publique(rsv.normaliser(None)) is None


def test_le_total_tient():
    r = neuve()
    assert rsv.prendre(r) and (r["groupe"], r["mj"]) == (3, 1)
    rsv.passer(r, "mj")
    rsv.passer(r, "groupe")
    rsv.rendre(r)
    assert (r["groupe"], r["mj"]) == (4, 0) and rsv.total(r) == 4
    with pytest.raises(demandes.Refus):
        rsv.rendre(r)
    with pytest.raises(demandes.Refus):
        rsv.passer(r, "groupe")
    with pytest.raises(demandes.Refus):
        rsv.passer(r, "ailleurs")
    for _ in range(4):
        assert rsv.prendre(r)
    assert not rsv.prendre(r) and (r["groupe"], r["mj"]) == (0, 4)
    # Éteinte, la règle ne prend rien.
    r["actif"] = False
    rsv.passer(r, "groupe")
    assert not rsv.prendre(r)


def test_regler_le_total():
    r = neuve(groupe=1, mj=3)
    rsv.regler(r, nouveau_total=6)
    assert (r["groupe"], r["mj"]) == (3, 3)
    rsv.regler(r, nouveau_total=2)
    # Le groupe d'abord, puis le MJ.
    assert (r["groupe"], r["mj"]) == (0, 2)
    for faux in (0, rsv.TOTAL_MAX + 1, 2.5, True, "4"):
        with pytest.raises(demandes.Refus):
            rsv.regler(r, nouveau_total=faux)
    with pytest.raises(demandes.Refus):
        rsv.regler(r, actif="oui")
    rsv.imposer(r, "lea", "ysolde", None)
    # « Tout au groupe » : comme au début d'une séance, le MJ sans rien, plus aucune annonce, le total gardé.
    rsv.regler(r, remettre=True)
    assert (r["groupe"], r["mj"], r["mesaventures"]) == (2, 0, {})
    r["mj"], r["groupe"] = 1, 1
    rsv.imposer(r, "lea", "ysolde", None)
    rsv.regler(r, actif=False)
    assert r["mesaventures"] == {} and r["actif"] is False


def test_les_mesaventures_annoncees():
    r = neuve(groupe=2, mj=2)
    rsv.imposer(r, "lea", "ysolde", None)
    # Une nouvelle annonce pour le même joueur remplace l'ancienne ; pas plus d'annonces que de dés au MJ.
    rsv.imposer(r, "lea", "ysolde", 3)
    rsv.imposer(r, "basile", "tavarede", None)
    with pytest.raises(demandes.Refus) as refus:
        rsv.imposer(r, "cyrielle", "vortan", None)
    assert refus.value.statut == 409 and "déjà annoncé" in refus.value.message
    m, roule = rsv.consommer(r, "lea")
    assert roule and m["face"] == 3 and (r["groupe"], r["mj"]) == (3, 1)
    # Une seule fois.
    assert rsv.consommer(r, "lea") == (None, False)
    # La réserve du MJ vidée à la main entre-temps : l'annonce tombe, sans dé.
    rsv.passer(r, "groupe")
    m, roule = rsv.consommer(r, "basile")
    assert m and not roule and (r["groupe"], r["mj"]) == (4, 0)
    r["actif"] = False
    with pytest.raises(demandes.Refus) as refus:
        rsv.imposer(r, "lea", "ysolde", None)
    assert refus.value.message == rsv.ETEINTE


def test_le_fichier(tmp_path):
    res = rsv.Reserve(tmp_path)
    assert res.lire()["groupe"] == 4 and rsv.publique_du_fichier(tmp_path) is None
    r = res.lire()
    rsv.regler(r, actif=True)
    rsv.prendre(r)
    res.ecrire(r)
    assert rsv.publique_du_fichier(tmp_path) == {"aventure": 3, "mesaventure": 1}
    r = res.lire()
    rsv.regler(r, actif=False)
    res.ecrire(r)
    assert rsv.publique_du_fichier(tmp_path) is None
    (tmp_path / rsv.FICHIER).write_text("{abîmé", encoding="utf-8")
    assert res.lire() == rsv.normaliser(None)
