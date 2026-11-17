"""Les tâches de fond de la vague 4 (fiches de jet, aide à l'écriture) : une erreur qui se répète (un dossier pris, un
fichier illisible) n'est notée qu'une fois, la tâche continue de réessayer, et une erreur nouvelle se note de nouveau."""
import asyncio
import logging
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

from coin_mj import aide_mj  # noqa: E402
from coin_mj import jets_mj  # noqa: E402
import main  # noqa: E402
from api import actions_coin, commandes_api  # noqa: E402


def tourner(coro_fn, duree: float):
    async def tout():
        t = asyncio.create_task(coro_fn())
        await asyncio.sleep(duree)
        t.cancel()
        try:
            await t
        except asyncio.CancelledError:
            pass
    asyncio.run(tout())


def test_les_fiches_de_jet_ne_remplissent_pas_le_journal(monkeypatch, caplog):
    essais = {"n": 0}

    def sources():
        essais["n"] += 1
        if essais["n"] <= 6:
            raise PermissionError("dossier pris")
        if essais["n"] <= 9:
            raise OSError("autre panne")
        return []

    monkeypatch.setattr(jets_mj, "SOURCES_PERIODE", 0.02)
    monkeypatch.setattr(actions_coin.jets_mj, "sources", sources)
    monkeypatch.setattr(actions_coin.jets_mj, "publier", lambda: 0)
    monkeypatch.setattr(actions_coin.jets_mj, "vu", None)
    with caplog.at_level(logging.ERROR, logger="atelier.jets"):
        tourner(actions_coin.jets_mj.veiller, 0.6)
    notes = [r for r in caplog.records if r.name == "atelier.jets"]
    assert essais["n"] > 10, essais  # elle a continué de réessayer
    assert len(notes) == 2, [r.getMessage() for r in notes]  # une fois chaque erreur
    assert actions_coin.jets_mj.vu == {}  # puis elle a publié


def test_l_ouvrier_de_l_aide_ne_remplit_pas_le_journal(monkeypatch, caplog):
    essais = {"n": 0}

    def publier_etat():
        essais["n"] += 1
        if essais["n"] <= 6:
            raise OSError("disque plein")
        return False

    async def rien():
        return 0

    a = commandes_api.aides_joueurs
    monkeypatch.setattr(aide_mj, "RELECTURE", 0.02)
    monkeypatch.setattr(a, "publier_etat", publier_etat)
    monkeypatch.setattr(a, "tout_traiter", rien)
    with caplog.at_level(logging.ERROR, logger="atelier.aide"):
        tourner(a.ouvrier, 0.4)
    notes = [r for r in caplog.records if r.name == "atelier.aide"]
    assert essais["n"] > 6, essais
    assert len(notes) == 1, [r.getMessage() for r in notes]


# ---------------------------------------------------------------- les billets privés : une publication à la fois

def test_un_billet_retire_ne_revient_pas_par_une_publication_en_retard(tmp_path):
    """La veille des billets publie de secours pendant que le MJ en retire un : la publication partie avant le retrait ne
    doit pas écrire après celle du retrait (le billet reviendrait sur le téléphone jusqu'au passage suivant)."""
    import hashlib
    import threading

    from commun import carnet
    from commun import prives
    from coin_mj import prives_mj

    depot, donnees = tmp_path / "propositions", tmp_path / "data"
    depot.mkdir()
    donnees.mkdir()
    dedans, lacher = threading.Event(), threading.Event()
    retenir = {"oui": False}

    def candidats():
        # La publication de secours s'arrête ici, ses envois déjà lus, jusqu'à ce que l'essai la relâche.
        if retenir["oui"] and threading.current_thread().name == "secours":
            dedans.set()
            lacher.wait(5)
        return []

    async def rien(_m):
        return None

    p = prives_mj.PrivesMJ(
        depot, donnees, joueurs_lus=lambda: [{"id": "lea", "jeton": "jeton-de-lea", "nom": "Léa"}],
        heros_des_joueurs=lambda: {"lea": {"id": "aude", "nom": "Aude Gris"}}, tablee=lambda: [],
        lire_seance=lambda _i: None, lire_document=lambda i: {"id": i, "nom": "Lettre", "texte": "Au gué, ce soir.", "genre": "lettre"},
        masquer_tout=lambda x: x, candidats=candidats, retenir=lambda *a: None, secrets_dans=lambda _t, _c: [],
        noms_secrets=lambda t: ", ".join(map(str, t)), image_source=lambda _u: None, sources=lambda: [], signaler=rien)
    p.remettre_document("lettre", "aude", True)
    p.publier()
    cle = carnet.cle_heros(hashlib.sha256(b"jeton-de-lea").hexdigest())
    [billet] = prives.lire(depot, cle)

    retenir["oui"] = True
    secours = threading.Thread(target=p.publier, name="secours")
    secours.start()
    assert dedans.wait(5)

    def retrait():
        p.retirer(p.lire()[0]["id"])
        p.publier()

    mj = threading.Thread(target=retrait, name="le MJ")
    mj.start()
    mj.join(0.3)  # le MJ retire pendant que la publication de secours est en route
    lacher.set()
    secours.join(5)
    mj.join(5)
    assert not secours.is_alive() and not mj.is_alive()
    assert prives.lire(depot, cle) == [], "le billet retiré est revenu sur le téléphone"


# ---------------------------------------------------------------- l'aide : l'état publié pour le coin

def test_l_etat_de_l_aide_publie_suit_le_dernier_reglage(tmp_path, monkeypatch):
    """L'ouvrier publie l'état pendant que le MJ change le nombre d'aides : celui qui a lu l'ancien réglage ne doit pas
    écrire après (le coin dirait l'ancien nombre jusqu'au passage suivant)."""
    import json
    import threading

    from commun import aide
    from ia import redaction

    depot, donnees = tmp_path / "propositions", tmp_path / "data"
    depot.mkdir()
    donnees.mkdir()
    monkeypatch.setattr(redaction, "JOURNAL", tmp_path / "journal-ia.jsonl")
    a = aide_mj.AideMJ(depot, donnees, joueurs_lus=lambda: [{"id": "lea", "nom": "Léa"}], fiche_publiee=lambda _j: None,
                       contexte=lambda: [], extraits=lambda _t: "", candidats=lambda _j: [], carnet_ouvert=lambda: True,
                       finir=lambda t: t, sans_balise=lambda t: t, disponible=lambda: True)
    a.publier_etat()
    dedans, lacher = threading.Event(), threading.Event()
    usage = a.usage

    def usage_lent(mois=None):
        # L'ouvrier s'arrête ici, les réglages d'avant déjà lus, jusqu'à ce que l'essai le relâche.
        if threading.current_thread().name == "ouvrier":
            dedans.set()
            lacher.wait(5)
        return usage(mois)

    monkeypatch.setattr(a, "usage", usage_lent)
    ouvrier = threading.Thread(target=a.publier_etat, name="ouvrier")
    ouvrier.start()
    assert dedans.wait(5)
    mj = threading.Thread(target=a.regler, args=({"par_joueur": 3},), name="onglet Table")
    mj.start()
    mj.join(0.3)
    lacher.set()
    ouvrier.join(5)
    mj.join(5)
    etat = json.loads((depot / aide.DOSSIER / aide.ETAT).read_text(encoding="utf-8"))
    assert etat["par_joueur"] == 3 and etat["joueurs"]["lea"]["limite"] == 3, etat
