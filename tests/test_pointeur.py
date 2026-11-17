"""Le pointeur du MJ : la position de sa souris sur le plan ou la carte ouverts, montrée en direct sur la TV. Rien ne
s'écrit, rien ne passe à Internet par ce chemin, et seuls les écrans qui montrent ce plan ou cette carte reçoivent le
point (ceux d'Internet seulement si la table publique est ouverte)."""

import json
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from starlette.websockets import WebSocketDisconnect  # noqa: E402

import main  # noqa: E402
from api import application, config, portier, tv_boutique_combat, tv_cartes, tv_temps_reel  # noqa: E402
from sources_front import source_page  # noqa: E402

CF = {"CF-Connecting-IP": "203.0.113.7"}
STATIQUE = Path(__file__).resolve().parent.parent / "app" / "static"


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture
def table_ouverte():
    """La table publique sans réglage (donc ouverte), et rendue ainsi."""
    config.TABLE_OUVERTURE.unlink(missing_ok=True)
    yield
    config.TABLE_OUVERTURE.unlink(missing_ok=True)


def montrer(client, **etat):
    assert client.put("/api/table", json={"camera": None, **etat}).status_code == 200


def pointer(ws, **m):
    ws.send_text(json.dumps(m))


def point(genre, ident, x, y, de=None, onde=False):
    attendu = {"type": "pointeur", genre: tv_cartes.jeton(tv_boutique_combat.REFS_TABLE[genre], ident), "x": x, "y": y}
    if onde:
        attendu["onde"] = True
    return attendu


def sans_source(m):
    m = dict(m)
    assert isinstance(m.pop("de"), int)
    return m


def empreinte_des_donnees():
    return {str(f.relative_to(config.DONNEES)): (f.stat().st_size, f.stat().st_mtime_ns, f.read_bytes())
            for f in config.DONNEES.rglob("*") if f.is_file()}


def test_le_pointeur_est_ferme_a_internet(client, monkeypatch):
    # Par Cloudflare : la garde ferme le WebSocket avant même de l'ouvrir, et la route n'existe pas en HTTP.
    with pytest.raises(WebSocketDisconnect) as refus:
        with client.websocket_connect("/ws/pointeur", headers=CF):
            pass  # ouvert : l'essai échoue (sans attendre un message qui ne viendrait pas)
    assert refus.value.code == 1008
    assert client.get("/ws/pointeur", headers=CF).status_code == 404
    # Par le nom public seul, sans en-tête de Cloudflare : même refus.
    monkeypatch.setattr(portier, "TABLE_PUBLIQUE", {"table.example.ch"})
    monkeypatch.setattr(portier, "HOTES", portier.HOTES | {"table.example.ch"})
    with pytest.raises(WebSocketDisconnect) as refus:
        with client.websocket_connect("/ws/pointeur", headers={"Host": "table.example.ch"}):
            pass
    assert refus.value.code == 1008
    # Un site ouvert dans le même navigateur ne s'y branche pas non plus.
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/pointeur", headers={"Origin": "http://ailleurs.example"}):
            pass


def test_le_point_ne_va_qu_aux_ecrans_du_plan_montre(client, table_ouverte):
    montrer(client, vue="plan", plan="la-ferme-essai")
    with client.websocket_connect("/ws/table") as salon, client.websocket_connect("/ws/table", headers=CF) as dehors, \
            client.websocket_connect("/ws/pointeur") as mj:
        for ecran in (salon, dehors):
            assert ecran.receive_json()["type"] == "etat"
        # Un autre plan que celui de la TV : rien ne part, et l'éditeur l'apprend.
        pointer(mj, plan="un-autre-plan", x=1, y=2)
        assert mj.receive_json() == {"type": "portee", "ici": False, "ecrans": 0}
        # Une carte du même nom que le plan montré : rien non plus.
        pointer(mj, carte="la-ferme-essai", x=1, y=2)
        # Le plan de la TV : le salon et Internet (table ouverte) reçoivent le point, en cases, avec son onde.
        pointer(mj, plan="la-ferme-essai", x=3.14159, y=2, onde=True)
        for ecran in (salon, dehors):
            recu = ecran.receive_json()
            assert sans_source(recu) == point("plan", "la-ferme-essai", 3.142, 2, onde=True)
            assert "la-ferme-essai" not in json.dumps(recu)
        assert mj.receive_json() == {"type": "portee", "ici": True, "ecrans": 2}
        # La portée ne revient que lorsqu'elle change.
        pointer(mj, plan="la-ferme-essai", x=4, y=2.5)
        for ecran in (salon, dehors):
            assert sans_source(ecran.receive_json()) == point("plan", "la-ferme-essai", 4, 2.5)
        # La TV passe sur une image : le point ne la suit pas.
        montrer(client, vue="image", url=None, titre="Une image")
        for ecran in (salon, dehors):
            assert ecran.receive_json()["type"] == "etat"
        pointer(mj, plan="la-ferme-essai", x=5, y=2.5)
        assert mj.receive_json() == {"type": "portee", "ici": False, "ecrans": 0}
        # Puis sur une carte : seul le point de cette carte-là passe.
        montrer(client, vue="carte", carte="le-monde-essai")
        for ecran in (salon, dehors):
            assert ecran.receive_json()["type"] == "etat"
        pointer(mj, plan="le-monde-essai", x=1, y=1)
        pointer(mj, carte="le-monde-essai", x=120.5, y=80)
        for ecran in (salon, dehors):
            assert sans_source(ecran.receive_json()) == point("carte", "le-monde-essai", 120.5, 80)


def test_l_editeur_qui_relit_la_table_reapprend_la_portee(client, table_ouverte):
    # Aucun écran ouvert : l'éditeur l'apprend au premier point, puis plus rien tant que rien ne change.
    montrer(client, vue="plan", plan="la-ferme-essai")
    with client.websocket_connect("/ws/pointeur") as mj:
        pointer(mj, plan="la-ferme-essai", x=1, y=1)
        assert mj.receive_json() == {"type": "portee", "ici": True, "ecrans": 0}
        pointer(mj, plan="la-ferme-essai", x=2, y=1)
        # Il a relu la table (et l'a dite au MJ d'après elle) : la portée revient au point suivant, même inchangée.
        pointer(mj, relire=True)
        pointer(mj, plan="la-ferme-essai", x=3, y=1)
        assert mj.receive_json() == {"type": "portee", "ici": True, "ecrans": 0}
        # Une seule fois : le message suivant est le changement qui suit, pas un double de la même portée.
        pointer(mj, plan="la-ferme-essai", x=4, y=1)
        pointer(mj, plan="un-autre-plan", x=4, y=1)
        assert mj.receive_json() == {"type": "portee", "ici": False, "ecrans": 0}
        # La TV part puis revient entre deux points, l'éditeur ayant relu la table entre-temps : il le réapprend aussi.
        pointer(mj, plan="la-ferme-essai", x=1, y=1)
        assert mj.receive_json() == {"type": "portee", "ici": True, "ecrans": 0}
        with client.websocket_connect("/ws/table") as tv:
            tv.receive_json()
            pointer(mj, plan="la-ferme-essai", x=2, y=2)
            assert sans_source(tv.receive_json()) == point("plan", "la-ferme-essai", 2, 2)
            assert mj.receive_json() == {"type": "portee", "ici": True, "ecrans": 1}
            pointer(mj, relire=True)
            pointer(mj, plan="la-ferme-essai", x=3, y=2)
            assert sans_source(tv.receive_json()) == point("plan", "la-ferme-essai", 3, 2)
            assert mj.receive_json() == {"type": "portee", "ici": True, "ecrans": 1}


def test_table_publique_fermee_internet_ne_recoit_pas_le_point(client, table_ouverte):
    montrer(client, vue="plan", plan="la-ferme-essai")
    with client.websocket_connect("/ws/table") as salon, client.websocket_connect("/ws/table", headers=CF) as dehors, \
            client.websocket_connect("/ws/pointeur") as mj:
        salon.receive_json(), dehors.receive_json()
        assert client.put("/api/table-publique", json={"ouverte": False}).status_code == 200
        assert dehors.receive_json()["etat"]["vue"] == "accueil"
        pointer(mj, plan="la-ferme-essai", x=2, y=3, onde=True)
        assert sans_source(salon.receive_json()) == point("plan", "la-ferme-essai", 2, 3, onde=True)
        assert mj.receive_json() == {"type": "portee", "ici": True, "ecrans": 1}
        pointer(mj, efface=True)
        assert sans_source(salon.receive_json()) == {"type": "pointeur", "efface": True}
        # Rouverte : le premier message qu'Internet reçoit est l'état de la table, ni le point ni son effacement.
        assert client.put("/api/table-publique", json={"ouverte": True}).status_code == 200
        assert dehors.receive_json()["type"] == "etat"
        pointer(mj, plan="la-ferme-essai", x=6, y=3)
        assert sans_source(dehors.receive_json()) == point("plan", "la-ferme-essai", 6, 3)


def test_le_point_s_efface_quand_l_editeur_se_ferme(client, table_ouverte):
    montrer(client, vue="plan", plan="la-ferme-essai")
    with client.websocket_connect("/ws/table") as salon:
        salon.receive_json()
        with client.websocket_connect("/ws/pointeur") as mj:
            pointer(mj, efface=True)  # rien à effacer : rien ne part
            pointer(mj, plan="la-ferme-essai", x=1, y=1)
            de = salon.receive_json()["de"]
            mj.receive_json()
            # L'onglet de l'éditeur fermé (ou la liaison perdue) : le point quitte la TV. La fermeture est envoyée ici,
            # et l'effacement attendu avant de sortir du bloc : en sortant, le client d'essai coupe aussitôt la tâche du
            # serveur, qui sur une machine chargée n'avait parfois pas encore envoyé l'effacement (le test attendait
            # alors le « ping » de la TV, 45 secondes plus tard, et échouait).
            mj.close()
            assert salon.receive_json() == {"type": "pointeur", "de": de, "efface": True}
        # Deux éditeurs : chacun a sa source, la TV n'efface que celui qui lui demande.
        with client.websocket_connect("/ws/pointeur") as mac, client.websocket_connect("/ws/pointeur") as ipad:
            pointer(mac, plan="la-ferme-essai", x=1, y=1)
            pointer(ipad, plan="la-ferme-essai", x=2, y=2)
            sources = {salon.receive_json()["de"], salon.receive_json()["de"]}
            assert len(sources) == 2 and de not in sources


def test_rien_ne_s_ecrit_et_un_message_illisible_est_ignore(client, table_ouverte):
    montrer(client, vue="plan", plan="la-ferme-essai")
    etat = config.TABLE.read_bytes()
    with client.websocket_connect("/ws/table") as salon, client.websocket_connect("/ws/pointeur") as mj:
        salon.receive_json()
        avant = empreinte_des_donnees()
        mj.send_bytes(json.dumps({"plan": "la-ferme-essai", "x": 1, "y": 1}).encode())
        for brut in ("", "pas du json", "[]", "null", '{"plan": "la-ferme-essai", "x": NaN, "y": 1}',
                     '{"plan": "la-ferme-essai", "x": Infinity, "y": 1}', '{"plan": "la-ferme-essai", "x": 1e300, "y": 1}'):
            mj.send_text(brut)
        for m in ({"plan": "../la-ferme-essai", "x": 1, "y": 1}, {"plan": "La-Ferme", "x": 1, "y": 1},
                  {"plan": "la-ferme-essai", "x": "1", "y": 1}, {"plan": "la-ferme-essai", "x": True, "y": 1},
                  {"plan": "la-ferme-essai", "x": 1}, {"plan": ["la-ferme-essai"], "x": 1, "y": 1},
                  {"plan": "la-ferme-essai", "x": 1, "y": 1, "bourrage": "x" * 500}, {"vue": "accueil"}, {"efface": "oui"},
                  {"relire": "oui"}):
            pointer(mj, **m)
        # « relire » ne part jamais vers la TV et n'écrit rien.
        pointer(mj, relire=True)
        # Le premier message à passer est le seul lisible : aucun des autres n'est allé à la TV.
        pointer(mj, plan="la-ferme-essai", x=7, y=8, onde="oui")
        assert sans_source(salon.receive_json()) == point("plan", "la-ferme-essai", 7, 8)
        assert mj.receive_json()["type"] == "portee"
        pointer(mj, efface=True)
        assert salon.receive_json()["efface"] is True
        assert empreinte_des_donnees() == avant
    assert config.TABLE.read_bytes() == etat
    assert client.get("/api/table").json()["vue"] == "plan"


def test_un_ecran_de_table_ne_pointe_pas(client, table_ouverte):
    montrer(client, vue="plan", plan="la-ferme-essai")
    etat = config.TABLE.read_bytes()
    with client.websocket_connect("/ws/table") as tv, client.websocket_connect("/ws/table", headers=CF) as dehors, \
            client.websocket_connect("/ws/pointeur") as mj:
        tv.receive_json(), dehors.receive_json()
        # Ce qu'un écran de table envoie sur sa liaison ne pilote rien : ni point, ni effacement, ni état.
        dehors.send_text(json.dumps({"plan": "la-ferme-essai", "x": 1, "y": 1, "onde": True}))
        dehors.send_text(json.dumps({"type": "pointeur", "plan": tv_cartes.jeton("plans", "la-ferme-essai"), "x": 1, "y": 1}))
        dehors.send_text(json.dumps({"efface": True}))
        tv.send_text(json.dumps({"vue": "accueil"}))
        pointer(mj, plan="la-ferme-essai", x=9, y=9)
        assert sans_source(tv.receive_json()) == point("plan", "la-ferme-essai", 9, 9)
        assert sans_source(dehors.receive_json()) == point("plan", "la-ferme-essai", 9, 9)
    assert config.TABLE.read_bytes() == etat


def test_le_debit_est_borne(client, table_ouverte):
    montrer(client, vue="plan", plan="la-ferme-essai")
    with client.websocket_connect("/ws/table") as salon, client.websocket_connect("/ws/pointeur") as mj:
        salon.receive_json()
        for i in range(150):
            pointer(mj, plan="la-ferme-essai", x=i / 10, y=1)
        pointer(mj, efface=True)
        recus = 0
        while not salon.receive_json().get("efface"):
            recus += 1
        # La réserve (40) et ce qui se reconstitue pendant l'essai, pas les 150.
        assert tv_temps_reel.POINTEUR_PAR_SECONDE <= recus < 75


def test_la_tv_montre_le_point_sans_rien_renvoyer():
    """Le calque du pointeur suit le plan dans la page, sans z-index (sous les cartons, le bandeau et la légende) ; le
    script de la TV n'écrit jamais sur sa liaison."""
    page = (STATIQUE / "table.html").read_text(encoding="utf-8")
    assert page.index('id="plan"') < page.index('class="pointeur-tv"') < page.index('class="legende-heros"')
    css = (STATIQUE / "css" / "table.css").read_text(encoding="utf-8")
    regle = css[css.index(".pointeur-tv {"):].split("}", 1)[0]
    assert "z-index" not in regle and "position: fixed" in regle
    table = source_page("table")
    assert 'msg.type === "pointeur"' in table and "ws.send" not in table
    calque = (STATIQUE / "js" / "ecran-tv/pointeur-tv.js").read_text(encoding="utf-8")
    assert "fetch(" not in calque and "WebSocket" not in calque
    # Les éditeurs seuls chargent l'outil (ni la TV, ni le coin des joueurs).
    for js in ("plan/editeur.js", "carte/editeur.js"):
        assert 'from "../ecran-tv/pointeur.js"' in (STATIQUE / "js" / js).read_text(encoding="utf-8")
    assert "pointeur.js" not in table.replace("pointeur-tv.js", "")
