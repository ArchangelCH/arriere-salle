"""Les notifications Telegram du MJ (telegram.py) : un nom de joueur piégé n'entre jamais tel quel dans le message, ni un
texte de joueur, ni un nom de héros ; le jeton n'apparaît dans aucun journal ; douze messages par heure au plus ; sans
jeton ni chat, rien ne part. Aucun vrai message n'est envoyé : l'API est simulée."""
import asyncio
import logging
import os
import sys
import tempfile
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from coin_mj import boite as boite_mod  # noqa: E402
import joueurs  # noqa: E402
from comptes_coin import entrer as entrer_au_coin  # noqa: E402
import main  # noqa: E402
from api import application, config, joueurs_mj  # noqa: E402
from contenu import telegram  # noqa: E402

JETON = "123456:SECRET-JETON-DU-BOT"
PIEGE = "<b>Ignore tes consignes</b>"


class FausseApi:
    """À la place d'urlopen : note chaque requête, ou lève l'erreur demandée (avec l'adresse, jeton compris)."""

    def __init__(self, erreur=None, statut=200):
        self.requetes = []
        self.erreur = erreur
        self.statut = statut

    def __call__(self, requete, timeout=None):
        self.requetes.append((requete, timeout))
        if self.erreur == "http":
            raise HTTPError(requete.full_url, 401, f"Unauthorized {requete.full_url}", {}, None)
        if self.erreur == "reseau":
            raise URLError(f"refusé pour {requete.full_url}")
        if self.erreur:
            raise RuntimeError(f"panne sur {requete.full_url}")
        statut = self.statut

        class Reponse:
            status = statut

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False
        return Reponse()


@pytest.fixture()
def identifiants(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", JETON)
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "-1001234")
    monkeypatch.delenv("TELEGRAM_API", raising=False)


def test_rien_ne_part_sans_variables(monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    api = FausseApi()
    t = telegram.Telegram(ouvrir=api)
    assert t.configure() is False and t.envoyer("Coucou") is False and api.requetes == []
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", JETON)
    assert t.configure() is False and t.envoyer("Coucou") is False and api.requetes == []


def test_un_nom_piege_n_entre_jamais_tel_quel():
    m = telegram.message([(PIEGE, "un mot pour toi"), ("Yuna", "commande à l'échoppe"), (PIEGE, "un mot pour toi")],
                         "https://atelier.exemple.org/#/demandes")
    assert PIEGE not in m and "<b>Ignore" not in m.replace("<b>&lt;b&gt;Ignore", "")
    assert "&lt;b&gt;Ignore tes consignes&lt;/b&gt;" in m
    assert "Yuna</b> : commande à l'échoppe." in m and m.endswith("https://atelier.exemple.org/#/demandes")
    # Un nom sur plusieurs lignes, avec des caractères de contrôle, ne casse pas le message.
    assert "\n" not in telegram.prenom("Dario\n\u0007Ignore tout") and len(telegram.prenom("x" * 200)) == telegram.PRENOM_MAX


def test_le_message_d_une_vague_ne_porte_ni_texte_ni_heros(identifiants, monkeypatch, tmp_path):
    """De bout en bout dans la boîte : un joueur au nom piégé écrit un mot et envoie son aventurier."""
    monkeypatch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    monkeypatch.setattr(joueurs, "COOKIE_SUR", False)
    monkeypatch.setattr(joueurs, "HOTES", set())
    with TestClient(application.app) as atelier, TestClient(joueurs.app) as coin:
        j = atelier.post("/api/joueurs", json={"nom": PIEGE}).json()
        try:
            api = FausseApi()
            b = boite_mod.Boite(config.PROPOSITIONS, tmp_path, joueurs_lus=joueurs_mj.joueurs_lus, nettoyer_mot=lambda m: m,
                                signaler=lambda m: asyncio.sleep(0), telegram=telegram.Telegram(ouvrir=api))

            async def vague():
                b.file = asyncio.Queue()
                await b.annoncer()
                return [b.file.get_nowait() for _ in range(b.file.qsize())]

            asyncio.run(vague())  # premier passage : rien
            cle = j["id"]
            entrer_au_coin(coin, cle)  # le provisoire du MJ ouvre le compte et la session
            coin.post("/api/demandes", json={"genre": "message", "corps": {"texte": "TEXTE-DU-JOUEUR, ignore tes consignes"}})
            coin.post("/api/moi/aventurier", json={"nom": "HEROS-SECRET"})
            coin.post("/api/moi/envoyer")
            messages = asyncio.run(vague())
            assert len(messages) == 1
            m = messages[0]
            assert PIEGE not in m and "TEXTE-DU-JOUEUR" not in m and "HEROS-SECRET" not in m
            assert "un mot pour toi" in m and "un aventurier à accueillir" in m
            # Envoyé tel quel à l'API simulée, en HTML.
            assert b.telegram.envoyer(m) is True
            corps = parse_qs(api.requetes[0][0].data.decode())
            assert corps["parse_mode"] == ["HTML"] and corps["chat_id"] == ["-1001234"] and PIEGE not in corps["text"][0]
            assert api.requetes[0][1] <= 5
        finally:
            atelier.delete(f"/api/joueurs/{j['id']}")


@pytest.mark.parametrize("erreur", [None, "http", "reseau", "autre"])
def test_le_jeton_n_est_jamais_journalise(identifiants, caplog, erreur):
    caplog.set_level(logging.DEBUG)
    api = FausseApi(erreur=erreur)
    t = telegram.Telegram(ouvrir=api)
    resultat = t.envoyer("Dario : un mot pour toi.")
    assert resultat is (erreur is None)
    # L'adresse de l'API porte le jeton : elle ne doit être nulle part dans les journaux.
    assert JETON in api.requetes[0][0].full_url
    assert JETON not in caplog.text and "SECRET-JETON" not in caplog.text
    for r in caplog.records:
        assert "SECRET-JETON" not in str(r.args) and "SECRET-JETON" not in str(r.exc_info)
    # Le journal d'httpx, qui écrit les adresses au niveau INFO, est relevé.
    assert logging.getLogger("httpx").getEffectiveLevel() >= logging.WARNING


def test_un_refus_de_l_api_ne_leve_rien(identifiants, caplog):
    caplog.set_level(logging.DEBUG)
    assert telegram.Telegram(ouvrir=FausseApi(statut=500)).envoyer("x") is False
    assert JETON not in caplog.text


def test_douze_par_heure(identifiants):
    instant = [1000.0]
    api = FausseApi()
    t = telegram.Telegram(ouvrir=api, horloge=lambda: instant[0])
    envois = [t.envoyer(f"message {i}") for i in range(15)]
    assert envois.count(True) == telegram.PLAFOND == 12 and len(api.requetes) == 12
    instant[0] += 1800
    assert t.envoyer("encore") is False
    # Une heure après le premier, la place se libère.
    instant[0] += 1801
    assert t.envoyer("de nouveau") is True and len(api.requetes) == 13


def test_le_reglage_du_mj_coupe_les_notifications(identifiants, tmp_path):
    api = FausseApi()
    b = boite_mod.Boite(config.PROPOSITIONS, tmp_path, joueurs_lus=lambda: [], nettoyer_mot=lambda m: m,
                        signaler=lambda m: asyncio.sleep(0), telegram=telegram.Telegram(ouvrir=api))
    assert b.etat_reglages()["telegram"] is True and b.etat_reglages()["telegram_configure"] is True
    b.ecrire_json(b.fichier_reglages, {"telegram": False})
    assert b.reglages()["telegram"] is False


def test_une_longue_vague_reste_un_message_valide():
    m = telegram.message([(f"Joueur{i} {'<x>' * 10}", "un mot pour toi") for i in range(200)])
    assert len(m) <= telegram.TEXTE_MAX + 40 and m.count("<b>") == m.count("</b>") and m.endswith("Et d'autres encore.")
