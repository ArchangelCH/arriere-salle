"""Le nom de la campagne dans les pages (commun/nom_campagne.py) : les repères des pages HTML sont remplacés en servant,
aucun ne reste visible, et le logo garde la forme qu'il avait (première et dernière lettres plus grandes)."""
import re
from pathlib import Path

from commun import campagne, nom_campagne

STATIQUE = Path(__file__).resolve().parents[1] / "app" / "static"


def test_le_logo_garde_sa_forme():
    assert nom_campagne.marque("Aventures") == '<tspan font-size="150">A</tspan>VENTURE<tspan font-size="150">S</tspan>'
    assert nom_campagne.longueur("Aventures") == ""
    assert "textLength" in nom_campagne.longueur("Un nom de campagne bien long")
    assert "<" not in nom_campagne.marque("<b>").replace("<tspan", "").replace("</tspan>", "")


def test_chaque_repere_des_pages_est_connu():
    for page in [*STATIQUE.glob("*.html"), *(STATIQUE / "joueurs").glob("*.html")]:
        servie = nom_campagne.nommer(page.read_text(encoding="utf-8"))
        assert "{{campagne." not in servie, page.name
    assert campagne.NOM and campagne.SOUS_TITRE and campagne.DEVISE


def test_les_pages_servies_portent_le_nom(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    import joueurs
    from api import application
    with TestClient(application.app) as atelier:
        table = atelier.get("/table").text
    assert "{{" not in table and nom_campagne.marque(campagne.NOM) in table
    assert re.search(r"<p class=\"devise\">[^<]+</p>", table)
    monkeypatch.setattr(joueurs, "HOTES", {"testserver"})
    with TestClient(joueurs.app) as coin:
        assert "{{" not in coin.get("/").text
