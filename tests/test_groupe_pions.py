"""Plusieurs pions choisis et déplacés ensemble dans l'éditeur de plan (js/plan/groupe-pions.js, editeur.js). La logique
se vérifie sous node (outils/verifier_groupe_pions.mjs) ; ici, ce qui se lit dans les sources : la vue accepte une liste
sans rien changer pour la TV ni le coin, le déplacement d'un joueur épargne tout le groupe tenu, la suppression de
plusieurs pions passe par le dialogue maison, et l'invité reçoit le module."""
import shutil
import subprocess
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RACINE / "app"))

import pytest  # noqa: E402

from mj import acces_mj  # noqa: E402

JS = RACINE / "app" / "static" / "js"


def lire(chemin):
    return (JS / chemin).read_text(encoding="utf-8")


def methode(source, signature):
    return source.split(f"\n  {signature} {{")[1].split("\n  }\n")[0]


@pytest.mark.skipif(shutil.which("node") is None, reason="node absent de l'image des essais")
def test_le_verifieur_passe():
    r = subprocess.run(["node", str(RACINE / "outils" / "verifier_groupe_pions.mjs")], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_l_invite_recoit_le_module():
    assert "js/plan/groupe-pions.js" in acces_mj.STATIQUES_INVITE
    # Un module sans page ni appel au serveur : rien que des fonctions.
    source = lire("plan/groupe-pions.js")
    assert "document" not in source and "api." not in source and 'from "./pions.js"' in source


def test_la_vue_accepte_une_liste_sans_rien_changer_ailleurs():
    """rendu.js et vue.js servent aussi la TV et le coin des joueurs : ils n'importent rien de plus, et une sélection d'un
    seul identifiant se dessine comme avant."""
    rendu = lire("plan/rendu.js")
    vue = lire("plan/vue.js")
    assert "Array.isArray(o.selection) ? o.selection.includes(t.id) : o.selection === t.id" in rendu
    assert "[].concat(this.selection || [], this.survol || [])" in vue
    for source in (rendu, vue):
        assert "groupe-pions" not in source
    # Ni la table ni le coin ne posent de sélection.
    for page in ("table/carte-plan.js", "joueurs/table-coin.js"):
        assert ".selection =" not in lire(page)


def test_le_groupe_tenu_est_protege_des_deplacements_des_joueurs():
    source = lire("plan/mouvements-joueurs.js")
    assert "(g.groupe || []).some((x) => x.id === m.pion)" in source
    assert 'sel === "pion" || sel === "pions"' in source


def test_l_editeur_tient_un_ensemble_de_pions():
    ed = lire("plan/editeur.js")
    bas = methode(ed, "basSelection(x, y, ev, genres)")
    # Maj, Ctrl ou Cmd + clic, ou « Sélection multiple » au doigt ; le rectangle ailleurs que sur un pion.
    assert "this.multiple || ev.shiftKey || ev.ctrlKey || ev.metaKey" in bas and 'type: "lasso"' in bas
    assert 'auLacher = plusieurs ? "retirer" : "seul"' in bas and "suiveurs(p.pions" in bas
    # Sans Maj, glisser sur le vide déplace toujours la vue.
    assert 'this.glisse = { type: "camera", px: ev.offsetX, py: ev.offsetY };' in bas
    # Le groupe se borne en bloc, au glissé comme aux flèches.
    assert "placeDuGroupe(o, suite" in methode(ed, "glisserObjet(x, y)")
    touche = methode(ed, "touche(ev)")
    assert "pasDuGroupe(groupe" in touche and "avecLesSelles(this.plan.pions, choisis)" in touche
    # Un seul pas d'annulation et un seul envoi pour tout le groupe.
    assert touche.count("this.instantane()") == 1 and methode(ed, "finGlisse(g)").count("this.modifie(true)") == 1
    # Suppr sur plusieurs pions : le dialogue maison d'abord.
    supprimer = methode(ed, "async supprimerPions(ids)")
    assert "await demander(" in supprimer and supprimer.index("await demander(") < supprimer.index("this.instantane()")
    assert "confirm(" not in ed and "prompt(" not in ed
    # Le panneau, le bouton de la barre d'outils et « Tous les héros ».
    assert "pions sélectionnés</h2>" in ed and "data-multi" in ed and ">Tous les héros</button>" in ed and ">Sélection multiple</button>" in ed
    assert 'data-action="groupe-cacher"' in ed and 'data-action="groupe-montrer"' in ed
    # Un autre outil que Sélection ou Pions éteint la sélection multiple.
    assert "if (!OUTILS_QUI_ENTRENT.includes(outil)) this.multiple = false;" in methode(ed, "choisirOutil(outil)")


def test_l_aide_des_touches_dit_les_gestes():
    touches = lire("commun/touches.js")
    plan = touches.split("  plan: {")[1]
    assert 'l("Maj+clic"' in plan and "rectangle" in plan and "tous les héros visibles" in plan
