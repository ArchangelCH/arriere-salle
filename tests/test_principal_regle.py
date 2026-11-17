"""Le compte principal des MJ se règle (ATELIER_MJ_PRINCIPAL) : un principal déjà écrit sous un autre identifiant arrête
l'atelier au démarrage, au lieu d'être oublié en silence avec ses fiches."""
import json

import pytest

from mj import comptes_mj, proprietes


def ecrire_comptes(donnees, ident):
    (donnees / "mj").mkdir(parents=True, exist_ok=True)
    (donnees / "mj" / "comptes.json").write_text(json.dumps({"comptes": [{"id": ident, "role": "principal"}]}), encoding="utf-8")


def test_sans_fichier_ou_avec_le_bon_principal_rien_ne_bloque(tmp_path):
    comptes_mj.verifier_principal(tmp_path)
    ecrire_comptes(tmp_path, proprietes.PRINCIPAL)
    comptes_mj.verifier_principal(tmp_path)


def test_un_autre_principal_arrete_l_atelier(tmp_path):
    ecrire_comptes(tmp_path, "quelquun")
    with pytest.raises(RuntimeError, match="ATELIER_MJ_PRINCIPAL=quelquun"):
        comptes_mj.verifier_principal(tmp_path)
