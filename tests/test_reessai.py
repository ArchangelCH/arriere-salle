"""Un enregistrement raté parce que le serveur ne répond pas repart seul (js/commun/reessai.js) : sur chaque écran qui
enregistre, jamais après un conflit ni un refus, et l'onglet ne se ferme pas sans prévenir tant que quelque chose n'est
pas enregistré. Le détail des pauses se vérifie avec node outils/verifier_reessai.mjs."""

import re
from pathlib import Path
from sources_front import source_page  # noqa: E402

JS = Path(__file__).resolve().parent.parent / "app" / "static" / "js"

# Les écrans qui enregistrent au fil de la saisie.
ECRANS = ["plan/editeur.js", "carte/editeur.js", "pnj/carnet.js", "aventuriers/createur.js", "scenarios/scenarios.js",
          "seances/seances.js", "seances/compagnie.js", "auberge/auberge.js", "combats/balance.js", "combats/combat.js"]


def lire(chemin):
    return (JS / chemin).read_text(encoding="utf-8")


def test_le_nouvel_essai_ne_vise_que_le_serveur_qui_ne_repond_pas():
    source = lire("commun/reessai.js")
    assert re.search(r"const PAUSES = \[3000, 10000, 30000\];", source)
    codes = re.search(r"s === 0 \|\| \[([\d, ]+)\]\.includes\(s\)", source)
    assert codes, "injoignable() : statut 0 et une liste de codes"
    codes = {int(c) for c in codes.group(1).split(",")}
    assert {502, 503} <= codes
    assert all(c >= 500 for c in codes), "jamais après un conflit (409) ni un autre refus (4xx)"
    assert 500 not in codes, "une erreur du serveur lui-même se répéterait"


def test_chaque_ecran_qui_enregistre_reessaie_et_le_dit():
    for chemin in ECRANS:
        source = lire(chemin)
        assert re.search(r'^import \{[^}]*\bReessai\b[^}]*\} from "\.\./commun/reessai\.js";$', source, flags=re.M), chemin
        assert re.search(r"new Reessai\(\(\) => this\.\w+\(\)", source), f"{chemin} : l'essai renvoie par l'enregistrement de l'écran"
        assert re.search(r"\.(echec|bilan)\(", source) and re.search(r"\.(reussite|bilan)\(", source), chemin
        assert re.search(r"\n  aEnregistrer\(\) \{", source), f"{chemin} : l'onglet doit savoir s'il reste à enregistrer"
        assert "beforeunload" not in source, f"{chemin} : l'avertissement de fermeture vit dans atelier.js"
    # Le coin des joueurs passe par le même créateur.
    assert "aEnregistrer()" in lire("joueurs/joueur.js")


def test_l_onglet_previent_avant_de_perdre_un_enregistrement():
    for chemin in ("atelier.js", "joueurs/joueur.js"):
        source = lire(chemin)
        bloc = re.search(r'addEventListener\("beforeunload", \(ev\) => \{(.*?)\n\}\);', source, flags=re.S)
        assert bloc, chemin
        assert "reessaisEnAttente()" in bloc.group(1) and re.search(r"aEnregistrer(\?\.)?\(\)", bloc.group(1)), chemin
        assert "relancerTout()" in source, f"{chemin} : les envois ratés partent aussi quand l'onglet se ferme"
    # Plan et carte : un envoi raté compte comme non enregistré, et repart en quittant la page.
    for chemin in ("plan/editeur.js", "carte/editeur.js"):
        source = lire(chemin)
        a_enregistrer = re.search(r"\n  aEnregistrer\(\) \{(.*?)\n  \}", source, flags=re.S).group(1)
        assert "erreur" in a_enregistrer or "echecCarte()" in a_enregistrer, chemin
        vider = re.search(r"\n  vider\(\) \{(.*?)\n  \}", source, flags=re.S).group(1)
        assert "erreur" in vider or "echecCarte()" in vider, chemin


def test_la_tv_n_enregistre_rien():
    table = source_page("table")
    assert "reessai" not in table.lower()
