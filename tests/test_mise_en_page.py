"""La relecture et la mise en page d'un scénario : le texte corrigé d'un chapitre est PROPOSÉ à côté de celui du MJ, jamais
écrit à sa place. Garde-fous avant de proposer (consignes, liens, mots-clés, liens courts, longueur, réponse entière),
dépôt sans changer la version du scénario (pas de 409 sur l'écran ouvert), tout le scénario à la suite ou en lots,
cloisonnement entre deux MJ, budget de l'invité, coûts. Le modèle est un faux client : aucun appel ne sort."""
import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from api import application, bible_api, config, contexte_du_modele, ia_api, scenarios_api  # noqa: E402
from ia import budget_mj, redaction  # noqa: E402
from mj import cloisonnement  # noqa: E402
import deux_mj  # noqa: E402
import faux_modele  # noqa: E402
from faux_modele import FauxClient  # noqa: E402

FINIS = []
CAS = json.loads((Path(__file__).parent / "mise-en-page-cas.json").read_text(encoding="utf-8"))

SOURCE = ("la taverne\nIls entrent dans l'auberge , [Lisette](#/pnj/lisette) les accueil.\n\n[[carte blanche : une serveuse]]\n\n"
          "Voir #contrebande et @[Le Borgne].\n")
CORRIGE = ("## La taverne\n\nIls entrent dans l'auberge, [Lisette](#/pnj/lisette) les accueille.\n\n[[carte blanche : une serveuse]]\n\n"
           "Voir #contrebande et @[Le Borgne].")


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture
def lore(tmp_path, monkeypatch):
    (tmp_path / "bible").mkdir()
    (tmp_path / "glossaire.md").write_text("# Glossaire\n\n**Toma** : paladin.", encoding="utf-8")
    (tmp_path / "bible" / "ton-et-table.md").write_text("# Le ton\n\nUne comédie dans un univers sérieux.", encoding="utf-8")
    (tmp_path / "bible" / "personnages.md").write_text("# Personnages\n\nGrimbal, nain du Calvère.", encoding="utf-8")
    monkeypatch.setattr(bible_api, "LORE", tmp_path)
    monkeypatch.setattr(redaction, "JOURNAL", tmp_path / "journal.jsonl")
    monkeypatch.setattr(redaction, "LOTS", tmp_path / "lots.json")
    # Le texte du MJ ne passe jamais par ce qui prépare un texte écrit par la rédaction (liens retirés, nom de l'auberge
    # masqué) : chaque passage par finir_texte est noté.
    FINIS.clear()
    vrai = ia_api.finir_texte
    monkeypatch.setattr(ia_api, "finir_texte", lambda contenu: FINIS.append(contenu) or vrai(contenu))
    redaction.regler_sources_liens(contexte_du_modele.sources_des_liens)
    yield tmp_path
    redaction.regler_sources_liens(contexte_du_modele.sources_des_liens)


def evenements(reponse):
    return [json.loads(l[6:]) for l in reponse.text.splitlines() if l.startswith("data: ")]


def scenario(client, *textes, entetes=None):
    chapitres = [{"id": f"c-{i}", "titre": f"Chapitre {i}", "texte": t} for i, t in enumerate(textes, 1)]
    r = client.post("/api/scenarios", json={"nom": "Essai de mise en page", "chapitres": chapitres}, headers=entetes or {})
    assert r.status_code == 200, r.text
    return r.json()


def flux(client, s, chapitre="c-1", **kw):
    return client.post(f"/api/flux/scenarios/{s['id']}/mises-en-page/{chapitre}", **kw)


# ---------------------------------------------------------------- l'empreinte et les garde-fous

@pytest.mark.parametrize("cas", CAS["empreintes"], ids=[repr(c["texte"][:20]) for c in CAS["empreintes"]])
def test_l_empreinte_est_celle_du_navigateur(cas):
    assert scenarios_api.empreinte(cas["texte"]) == cas["attendu"]


def test_une_correction_fidele_passe_les_garde_fous():
    propose = scenarios_api.nettoyer_mise_en_page(CORRIGE, SOURCE)
    assert scenarios_api.controler_mise_en_page(SOURCE, propose) == []
    # Les blancs de début et de fin du chapitre sont gardés : la comparaison ne montre que ce qui change vraiment.
    assert propose == CORRIGE + "\n"
    # Un texte de trois mots auquel on ajoute un intertitre dépasse 140 % : la marge des textes courts le laisse passer.
    assert scenarios_api.controler_mise_en_page("Ils entrent", "## Arrivée\n\nIls entrent.") == []


@pytest.mark.parametrize("propose, raison", [
    (CORRIGE.replace("une serveuse", "une serveuse rousse"), "consignes"),
    (CORRIGE.replace("[[carte blanche : une serveuse]]\n\n", ""), "consignes"),
    (CORRIGE + "\n\n[[pistes : la suite]]", "consignes"),
    (CORRIGE.replace("[Lisette](#/pnj/lisette)", "Lisette"), "lien manquant : « #/pnj/lisette »"),
    (CORRIGE.replace("#/pnj/lisette", "#/pnj/lisette-varenne"), "lien ajouté : « #/pnj/lisette-varenne »"),
    (CORRIGE + " Voir [la série](https://youtu.be/abcdefgh123).", "lien ajouté"),
    (CORRIGE.replace("#contrebande", "la contrebande"), "mot-clé manquant : « contrebande »"),
    (CORRIGE.replace("l'auberge", "l'#auberge"), "mot-clé ajouté : « auberge »"),
    (CORRIGE.replace("@[Le Borgne]", "Le Borgne"), "lien court manquant : « Le Borgne »"),
    (CORRIGE.replace("les accueille", "et @[Toma] les accueillent"), "lien court ajouté : « Toma »"),
    ("", "vide"),
])
def test_ce_que_les_garde_fous_refusent(propose, raison):
    raisons = scenarios_api.controler_mise_en_page(SOURCE, scenarios_api.nettoyer_mise_en_page(propose, SOURCE))
    assert raisons and raison in " ; ".join(raisons), raisons


def test_la_longueur_reste_dans_sa_fourchette():
    long = "Un paragraphe du chapitre, écrit par le MJ. " * 40
    assert scenarios_api.controler_mise_en_page(long, long[:int(len(long) * 0.75)]) == []
    assert "plus court" in scenarios_api.controler_mise_en_page(long, long[:int(len(long) * 0.6)])[0]
    assert scenarios_api.controler_mise_en_page(long, long + long[:int(len(long) * 0.35)]) == []
    assert "plus long" in scenarios_api.controler_mise_en_page(long, long + long[:int(len(long) * 0.5)])[0]
    # Une réponse coupée n'est jamais proposée, même si ce qui en est arrivé passerait.
    assert scenarios_api.controler_mise_en_page(long, long, coupe=True) == ["la réponse a été coupée avant la fin du chapitre"]


def test_le_nettoyage_ne_touche_qu_au_bloc_de_code_et_aux_tirets_cadratins():
    source = "Il entre — sans bruit.\n\n[[carte blanche : un garde — bourru]]\n"
    rendu = "```markdown\nIl entre — sans bruit.\n\n[[carte blanche : un garde — bourru]]\n```"
    propose = scenarios_api.nettoyer_mise_en_page(rendu, source)
    # Le tiret de la consigne reste : elle se recopie au caractère près.
    assert propose == "Il entre, sans bruit.\n\n[[carte blanche : un garde — bourru]]\n"
    assert scenarios_api.controler_mise_en_page(source, propose) == []
    # Un lien vers une vidéo inconnue de la bible et un nom d'auberge ne sont ni retirés ni masqués : c'est le texte du MJ.
    lien = "Voir [la scène](https://youtu.be/inventee999?t=1) à la Petite Fanfrelée."
    assert scenarios_api.nettoyer_mise_en_page(lien, lien) == lien


# ---------------------------------------------------------------- un chapitre, au fil

def test_un_chapitre_relu_est_propose_sans_changer_le_texte_ni_la_version(client, lore, monkeypatch):
    faux = FauxClient(CORRIGE)
    monkeypatch.setattr(redaction, "CLIENT", faux)
    s = scenario(client, SOURCE, "Un autre chapitre, que la relecture ne doit pas emporter.")
    r = flux(client, s)
    assert r.headers["content-type"].startswith("text/event-stream")
    evs = evenements(r)
    assert [e["t"] for e in evs][0] == "chapitre" and sum(e["t"] == "texte" for e in evs) > 1
    fin = evs[-1]
    assert fin["t"] == "fin" and fin["bilan"] == [{"chapitre": "c-1", "etat": "proposee"}] and fin["arret"] is None
    srv = client.get(f"/api/scenarios/{s['id']}").json()
    proposee = srv["mises_en_page"]["c-1"]
    assert proposee["texte"] == CORRIGE + "\n" and proposee["base"] == scenarios_api.empreinte(SOURCE) and proposee["date"]
    # Le texte du MJ n'a pas bougé, ni la version du scénario : l'écran ouvert enregistre sans 409.
    assert srv["chapitres"][0]["texte"] == SOURCE and srv["modifie"] == s["modifie"] and fin["scenario"] == srv
    ecran = {**s, "nom": "Renommé pendant la relecture", "version_base": s["modifie"], "mises_en_page": {"c-2": {"texte": "injecté"}}}
    apres = client.put(f"/api/scenarios/{s['id']}", json=ecran)
    assert apres.status_code == 200
    # Le champ ne s'écrit que par ses routes : l'enregistrement de l'écran garde la proposition et n'en ajoute pas.
    assert apres.json()["mises_en_page"] == {"c-1": proposee}
    # Ce qui est parti : le contexte léger (trois blocs, sans la bible entière), le chapitre seul, un effort mesuré.
    appel = faux.appels[0]
    demande = appel["messages"][0]["content"]
    assert len(appel["system"]) == 3 and appel["output_config"]["effort"] == "medium" and appel["max_tokens"] == ia_api.JETONS_MISE_EN_PAGE
    assert SOURCE in demande and "que la relecture ne doit pas emporter" not in demande and "2. Chapitre 2" in demande
    assert "[[…]]" in demande and "tiret cadratin" in demande and FINIS == []
    client.delete(f"/api/scenarios/{s['id']}")


@pytest.mark.parametrize("reponse, arret, message", [
    (CORRIGE, "max_tokens", "coupée"),
    (CORRIGE.replace("une serveuse", "une serveuse rousse"), "end_turn", "consignes"),
    (CORRIGE.replace("#contrebande", "la contrebande"), "end_turn", "mot-clé manquant"),
    ("Voici le chapitre corrigé.", "end_turn", "plus court"),
])
def test_un_refus_ne_propose_rien_et_le_dit(client, lore, monkeypatch, reponse, arret, message):
    monkeypatch.setattr(redaction, "CLIENT", FauxClient(reponse, arret=arret))
    s = scenario(client, SOURCE + "\nEncore un long paragraphe du MJ, pour que la longueur compte vraiment dans ce chapitre.\n" * 3)
    client.put(f"/api/scenarios/{s['id']}/mises-en-page/c-1", json={"texte": s["chapitres"][0]["texte"].replace("accueil.", "accueille.")})
    avant = client.get(f"/api/scenarios/{s['id']}").json()
    fin = evenements(flux(client, s))[-1]
    assert fin["t"] == "erreur" and fin["message"].startswith("Mise en page refusée : rien n'est proposé") and message in fin["message"]
    # Ni le texte, ni la proposition d'avant, ni la version : rien n'a changé.
    assert client.get(f"/api/scenarios/{s['id']}").json() == avant
    client.delete(f"/api/scenarios/{s['id']}")


def test_rien_a_corriger_ne_depose_rien(client, lore, monkeypatch):
    monkeypatch.setattr(redaction, "CLIENT", FauxClient(SOURCE, SOURCE))
    s = scenario(client, SOURCE)
    fin = evenements(flux(client, s))[-1]
    assert fin["bilan"] == [{"chapitre": "c-1", "etat": "inchange"}] and fin["scenario"]["mises_en_page"] == {}
    # Une proposition plus ancienne, que le texte a rejointe, s'en va.
    client.put(f"/api/scenarios/{s['id']}/mises-en-page/c-1", json={"texte": CORRIGE})
    assert evenements(flux(client, s))[-1]["scenario"]["mises_en_page"] == {}
    client.delete(f"/api/scenarios/{s['id']}")


def test_un_chapitre_change_pendant_la_relecture_n_est_pas_propose(client, lore, monkeypatch):
    s = scenario(client, SOURCE)
    chemin = config.SCENARIOS / f"{s['id']}.json"

    class PendantLEcriture(FauxClient):
        def stream(self, **kwargs):
            # Pendant que le texte s'écrit, le MJ retouche et enregistre son chapitre.
            fiche = json.loads(chemin.read_text(encoding="utf-8"))
            fiche["chapitres"][0]["texte"] = SOURCE + "\nUne phrase de plus.\n"
            chemin.write_text(json.dumps(fiche), encoding="utf-8")
            return super().stream(**kwargs)
    monkeypatch.setattr(redaction, "CLIENT", PendantLEcriture(CORRIGE))
    fin = evenements(flux(client, s))[-1]
    assert fin["t"] == "erreur" and "le chapitre a changé depuis la relecture" in fin["message"]
    assert client.get(f"/api/scenarios/{s['id']}").json()["mises_en_page"] == {}
    client.delete(f"/api/scenarios/{s['id']}")


def test_chapitre_vide_trop_long_ou_inconnu(client, lore, monkeypatch):
    faux = FauxClient()
    monkeypatch.setattr(redaction, "CLIENT", faux)
    s = scenario(client, "", "x" * (scenarios_api.CHAPITRE_MAX + 1))
    assert flux(client, s, "c-1").status_code == 400
    assert flux(client, s, "c-2").status_code == 413
    assert flux(client, s, "c-inconnu").status_code == 404
    assert client.post(f"/api/scenarios/{s['id']}/mises-en-page/c-inconnu/differee").status_code == 404
    assert client.post("/api/flux/scenarios/inconnu/mises-en-page/c-1").status_code == 404
    assert faux.appels == []
    monkeypatch.setattr(redaction, "CLIENT", None)
    s2 = scenario(client, SOURCE)
    assert flux(client, s2).status_code == 503
    for x in (s, s2):
        client.delete(f"/api/scenarios/{x['id']}")


# ---------------------------------------------------------------- tout le scénario, à la suite ou en lots

def test_tout_le_scenario_un_appel_par_chapitre(client, lore, monkeypatch):
    autre = "Le lendemain , ils repartent vers le #col.\n"
    faux = FauxClient(CORRIGE, autre.replace(" ,", ",").replace("#col", "col"), "Jamais demandé.")
    monkeypatch.setattr(redaction, "CLIENT", faux)
    s = scenario(client, SOURCE, "", autre, "y" * (scenarios_api.CHAPITRE_MAX + 1))
    evs = evenements(flux(client, s, "ensemble"))
    fin = evs[-1]
    # Le chapitre vide ne part pas ; le trop long est écarté sans appel ; un refus n'arrête pas la suite.
    assert len(faux.appels) == 2 and [e["chapitre"] for e in evs if e["t"] == "chapitre"] == ["c-1", "c-3"]
    assert {e["chapitre"] for e in evs if e["t"] == "texte"} == {"c-1", "c-3"}
    etats = {b["chapitre"]: b["etat"] for b in fin["bilan"]}
    assert etats == {"c-4": "refusee", "c-1": "proposee", "c-3": "refusee"} and fin["arret"] is None
    assert "mot-clé manquant" in next(b["message"] for b in fin["bilan"] if b["chapitre"] == "c-3")
    assert list(fin["scenario"]["mises_en_page"]) == ["c-1"] and fin["scenario"]["modifie"] == s["modifie"]
    # Chaque appel n'emporte que son chapitre.
    assert autre not in faux.appels[0]["messages"][0]["content"] and SOURCE not in faux.appels[1]["messages"][0]["content"]
    vide = scenario(client, "", "  \n")
    assert flux(client, vide, "ensemble").status_code == 400
    for x in (s, vide):
        client.delete(f"/api/scenarios/{x['id']}")


def test_une_panne_arrete_la_serie_et_garde_ce_qui_est_depose(client, lore, monkeypatch):
    class UneFois(FauxClient):
        def stream(self, **kwargs):
            if self.appels:
                self.erreur = redaction.anthropic.APIConnectionError(request=httpx.Request("POST", "https://exemple.invalid/"))
            return super().stream(**kwargs)
    monkeypatch.setattr(redaction, "CLIENT", UneFois(CORRIGE))
    s = scenario(client, SOURCE, "Un deuxième chapitre.", "Un troisième.")
    fin = evenements(flux(client, s, "ensemble"))[-1]
    assert fin["t"] == "fin" and "ne répond pas" in fin["arret"] and fin["bilan"] == [{"chapitre": "c-1", "etat": "proposee"}]
    assert list(fin["scenario"]["mises_en_page"]) == ["c-1"]
    client.delete(f"/api/scenarios/{s['id']}")


def test_en_lots_chaque_chapitre_a_le_sien_et_passe_les_garde_fous(client, lore, monkeypatch):
    autre = "Le lendemain , ils repartent.\n"
    faux = FauxClient(CORRIGE, "Voici.", "Relecture de nuit.")
    monkeypatch.setattr(redaction, "CLIENT", faux)
    s = scenario(client, SOURCE, autre, "")
    r = client.post(f"/api/scenarios/{s['id']}/mises-en-page/ensemble/differee").json()
    assert [l["cible"] for l in r["lots"]] == [
        {"scenario": s["id"], "chapitre": "c-1", "genre": "mise-en-page", "base": scenarios_api.empreinte(SOURCE)},
        {"scenario": s["id"], "chapitre": "c-2", "genre": "mise-en-page", "base": scenarios_api.empreinte(autre)}]
    assert r["arret"] is None and all(l["etat"] == "en-cours" and l["fonction"] == "mise-en-page" for l in r["lots"])
    params = faux.messages.batches.crees[0][0]["params"]
    assert len(params["system"]) == 3 and all("cache_control" not in b for b in params["system"]) and params["max_tokens"] == ia_api.JETONS_MISE_EN_PAGE
    # Un chapitre dont le lot est en cours n'en reçoit pas un second ; une relecture du canon en lot reste une relecture.
    assert client.post(f"/api/scenarios/{s['id']}/mises-en-page/c-1/differee").json()["lots"] == []
    client.post(f"/api/scenarios/{s['id']}/relectures/c-1/differee")
    assert len(client.get("/api/ia/lots").json()) == 3
    assert asyncio.run(redaction.relever_lots(ia_api.deposer_lot)) == 0
    srv = client.get(f"/api/scenarios/{s['id']}").json()
    assert srv["mises_en_page"] == {"c-1": {"texte": CORRIGE + "\n", "base": scenarios_api.empreinte(SOURCE), "date": srv["mises_en_page"]["c-1"]["date"]}}
    assert srv["relectures"]["c-1"]["texte"] == "Relecture de nuit." and srv["modifie"] == s["modifie"]
    etats = [(l["etat"], l.get("erreur", "")) for l in redaction.lots()]
    assert etats[0] == ("fait", "") and etats[2] == ("fait", "")
    assert etats[1][0] == "erreur" and etats[1][1].startswith("mise en page refusée : rien n'est proposé") and "fini" in redaction.lots()[1]
    # Seule la relecture du canon est passée par finir_texte.
    assert FINIS == ["Relecture de nuit."]
    client.delete(f"/api/scenarios/{s['id']}")


def test_un_lot_coupe_ou_perime_ne_propose_rien(client, lore, monkeypatch):
    faux = FauxClient()
    monkeypatch.setattr(redaction, "CLIENT", faux)
    s = scenario(client, SOURCE, "Un deuxième chapitre , à corriger.\n")
    client.post(f"/api/scenarios/{s['id']}/mises-en-page/ensemble/differee")

    async def resultats(ident):
        # Le premier lot revient coupé (limite de jetons), le second entier.
        coupe = ident == "lot_1"

        async def suite():
            texte = CORRIGE if coupe else "Un deuxième chapitre, à corriger."
            yield SimpleNamespace(custom_id="x", result=SimpleNamespace(type="succeeded", message=faux_modele.message(texte, "max_tokens" if coupe else "end_turn")))
        return suite()
    monkeypatch.setattr(faux.messages.batches, "results", resultats)
    # Entre-temps, le MJ a retouché le deuxième chapitre : la comparaison ne vaudrait plus rien.
    srv = client.get(f"/api/scenarios/{s['id']}").json()
    srv["chapitres"][1]["texte"] = "Un deuxième chapitre, réécrit.\n"
    assert client.put(f"/api/scenarios/{s['id']}", json={**srv, "version_base": srv["modifie"]}).status_code == 200
    asyncio.run(redaction.relever_lots(ia_api.deposer_lot))
    erreurs = [l.get("erreur", "") for l in redaction.lots()]
    assert "coupée" in erreurs[0] and "le chapitre a changé depuis la relecture" in erreurs[1]
    assert client.get(f"/api/scenarios/{s['id']}").json()["mises_en_page"] == {}
    # Le coût des deux lots est noté quand même : ils ont été payés.
    assert len([l for l in redaction.lignes_journal() if l["fonction"] == "mise-en-page" and l["lot"]]) == 2
    client.delete(f"/api/scenarios/{s['id']}")


# ---------------------------------------------------------------- déposer de l'extérieur, effacer

def test_deposer_et_effacer_par_leurs_routes(client, lore):
    s = scenario(client, SOURCE, "Un autre , chapitre.\n")
    url = f"/api/scenarios/{s['id']}/mises-en-page"
    r = client.put(f"{url}/c-1", json={"texte": CORRIGE})
    assert r.status_code == 200 and r.json()["mises_en_page"]["c-1"]["base"] == scenarios_api.empreinte(SOURCE)
    assert r.json()["modifie"] == s["modifie"]
    assert client.put(f"{url}/c-2", json={"texte": "Un autre, chapitre."}).status_code == 200
    # Les mêmes garde-fous que dans l'atelier, et une empreinte périmée refusée.
    refus = client.put(f"{url}/c-1", json={"texte": CORRIGE.replace("#contrebande", "contrebande")})
    assert refus.status_code == 422 and "mot-clé manquant" in refus.json()["detail"]
    assert client.put(f"{url}/c-1", json={"texte": CORRIGE, "base": "12-00000000"}).status_code == 422
    assert client.put(f"{url}/c-1", json={"texte": "  "}).status_code == 400
    assert client.put(f"{url}/c-1", json={"texte": "x" * (scenarios_api.PROPOSITION_MAX + 1)}).status_code == 413
    assert client.put(f"{url}/c-inconnu", json={"texte": "x"}).status_code == 404
    assert client.put("/api/scenarios/inconnu/mises-en-page/c-1", json={"texte": "x"}).status_code == 404
    apres = client.delete(f"{url}/c-1").json()
    assert list(apres["mises_en_page"]) == ["c-2"] and apres["modifie"] == s["modifie"]
    assert client.delete(f"{url}/c-inconnu").status_code == 200
    assert client.delete(f"{url}/ensemble").json()["mises_en_page"] == {}
    # Un scénario créé avec le champ ne le garde pas : il ne s'écrit que par ses routes.
    injecte = client.post("/api/scenarios", json={"nom": "Injecté", "chapitres": [], "mises_en_page": {"c-1": {"texte": "x"}}}).json()
    assert injecte["mises_en_page"] == {}
    for x in (s, injecte):
        client.delete(f"/api/scenarios/{x['id']}")


# ---------------------------------------------------------------- les coûts

def test_les_couts_et_les_estimations_connaissent_la_fonction(client, lore, monkeypatch):
    assert redaction.EFFORTS["mise-en-page"] == "medium" and redaction.NOMS_FONCTIONS["mise-en-page"] == "Relecture et mise en page"
    assert redaction.ESTIMATIONS["mise-en-page"] == ("mise-en-page", "leger")
    monkeypatch.setattr(redaction, "CLIENT", FauxClient(CORRIGE))
    s = scenario(client, SOURCE)
    assert evenements(flux(client, s))[-1]["t"] == "fin"
    couts = client.get("/api/ia/couts").json()
    assert couts["appels"] == 1 and couts["detail"][0] == {"fonction": "mise-en-page", "nom": "Relecture et mise en page", "appels": 1,
                                                          "cout": couts["detail"][0]["cout"]}
    assert "mise-en-page" in client.get("/api/ia/estimations").json()["usages"]
    client.delete(f"/api/scenarios/{s['id']}")


# ---------------------------------------------------------------- deux MJ : chacun ses scénarios, et le budget de l'invité

@pytest.fixture
def deux(client, lore, monkeypatch):
    avant = {f for f in config.DONNEES.rglob("*") if f.is_file()}
    monkeypatch.setattr(cloisonnement, "MODE", cloisonnement.STRICT)
    alban, lea = deux_mj.ouvrir(monkeypatch)
    cloisonnement.oublier()
    faux = FauxClient(*[CORRIGE] * 6)
    monkeypatch.setattr(redaction, "CLIENT", faux)
    ids = {"alban": scenario(client, SOURCE + "CANARI-ALBAN\n", entetes=alban)["id"], "lea": scenario(client, SOURCE, entetes=lea)["id"]}
    yield {"client": client, "alban": alban, "lea": lea, "ids": ids, "faux": faux}
    deux_mj.fermer()
    cloisonnement.oublier()
    for f in sorted({f for f in config.DONNEES.rglob("*") if f.is_file()} - avant, reverse=True):
        f.unlink(missing_ok=True)


def test_un_invite_ne_relit_que_ses_scenarios(deux):
    client, alban, lea, ids, faux = deux["client"], deux["alban"], deux["lea"], deux["ids"], deux["faux"]
    for qui, autre, h in (("lea", "alban", lea), ("alban", "lea", alban)):
        url = f"/api/scenarios/{ids[autre]}/mises-en-page"
        # Le scénario de l'autre n'existe pas pour lui : ni relire, ni déposer, ni effacer, ni lancer un lot.
        assert client.post(f"/api/flux/scenarios/{ids[autre]}/mises-en-page/c-1", headers=h).status_code == 404
        assert client.post(f"/api/flux/scenarios/{ids[autre]}/mises-en-page/ensemble", headers=h).status_code == 404
        assert client.put(f"{url}/c-1", json={"texte": CORRIGE}, headers=h).status_code == 404
        assert client.delete(f"{url}/c-1", headers=h).status_code == 404
        assert client.post(f"{url}/c-1/differee", headers=h).status_code == 404
    assert faux.appels == [] and faux.messages.batches.crees == []
    # Le sien, oui : proposé, noté pour lui, et son lot n'est lu que par lui.
    fin = evenements(client.post(f"/api/flux/scenarios/{ids['lea']}/mises-en-page/c-1", headers=lea))[-1]
    assert fin["t"] == "fin" and list(fin["scenario"]["mises_en_page"]) == ["c-1"]
    assert [l.get("qui") for l in redaction.lignes_journal()] == ["mj:lea"]
    assert client.get(f"/api/scenarios/{ids['alban']}", headers=alban).json()["mises_en_page"] == {}
    client.post(f"/api/scenarios/{ids['lea']}/mises-en-page/c-1/differee", headers=lea)
    assert [l["cible"]["scenario"] for l in client.get("/api/ia/lots", headers=lea).json()] == [ids["lea"]]
    assert client.get("/api/ia/lots", headers=alban).json() == []
    # Rien du scénario d'Alban n'est parti dans les demandes de Léa.
    assert "CANARI" not in json.dumps([faux.appels, faux.messages.batches.crees], ensure_ascii=False)


def test_le_budget_de_l_invite_arrete_la_mise_en_page(deux):
    client, alban, lea, ids, faux = deux["client"], deux["alban"], deux["lea"], deux["ids"], deux["faux"]
    mois = budget_mj.mois_courant()
    with redaction.JOURNAL.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"date": f"{mois}-01T10:00:00", "fonction": "consigne", "cout": 3.5, "qui": "mj:lea"}) + "\n")
    # Budget du mois atteint (3 $ par défaut) : 402 avant le flux comme avant le lot, et rien ne part.
    for url in (f"/api/flux/scenarios/{ids['lea']}/mises-en-page/c-1", f"/api/flux/scenarios/{ids['lea']}/mises-en-page/ensemble",
                f"/api/scenarios/{ids['lea']}/mises-en-page/ensemble/differee"):
        r = client.post(url, headers=lea)
        assert r.status_code == 402 and r.json()["detail"].startswith("Budget de rédaction du mois atteint")
    assert faux.appels == [] and faux.messages.batches.crees == []
    # Alban n'a pas de budget.
    assert evenements(client.post(f"/api/flux/scenarios/{ids['alban']}/mises-en-page/c-1", headers=alban))[-1]["t"] == "fin"


# ---------------------------------------------------------------- l'éditeur

def test_l_editeur_propose_et_n_ecrit_qu_au_geste_du_mj():
    js = (Path(__file__).resolve().parent.parent / "app" / "static" / "js" / "scenarios" / "scenarios.js").read_text(encoding="utf-8")
    for attendu in ("Relire et mettre en page", "Mise en page proposée", "Accepter tout le chapitre", "data-estimation=\"mise-en-page\"",
                    "from \"../lore/ecart.js\"", "from \"./mise-en-page.js\""):
        assert attendu in js, attendu
    # Le champ revient du serveur avec les autres annexes, et la comparaison ne s'applique qu'à un chapitre inchangé.
    assert "mises_en_page" in js[js.index("reprendreAnnexes(srv) {"):js.index("// Retour sur la page")]
    assert "empreinte(" in js
    # Ni confirm() ni prompt(), et la relecture du canon ne prend pas un lot de mise en page pour le sien.
    assert "confirm(" not in js and "prompt(" not in js and "!l.cible?.genre" in js
