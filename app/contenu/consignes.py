"""Les consignes laissées dans le texte d'un scénario : « [[carte blanche : …]] », « [[pistes : …]] »…

Même lecture que js/scenarios/consignes.js (vérifiée sur tests/consignes-cas.json des deux côtés). Une consigne se
reconnaît à son contenu (genre + indications, espaces resserrés) et à son rang parmi les consignes identiques du
scénario : c'est ce qui lui rattache sa proposition, où qu'elle soit déplacée dans le document.
"""
import hashlib
import re
import unicodedata

CONSIGNE = re.compile(r"\[\[([\s\S]*?)\]\]")
TETE = re.compile(r"^\s*([^:：\n\]]{1,24}?)\s*[:：]\s*([\s\S]*)$")

GENRES = {
    "rediger": "Carte blanche",
    "pistes": "Des pistes",
    "verifier": "Vérifier le canon",
    "pnj": "PNJ à créer",
    "combat": "Combat à régler",
}
ALIAS = {
    "carte blanche": "rediger", "rediger": "rediger", "redige": "rediger", "ecrire": "rediger", "ecris": "rediger",
    "completer": "rediger", "complete": "rediger", "decrire": "rediger", "decris": "rediger",
    "pistes": "pistes", "piste": "pistes", "proposer": "pistes", "propose": "pistes", "propositions": "pistes",
    "idees": "pistes", "options": "pistes",
    "verifier": "verifier", "verifie": "verifier", "canon": "verifier",
    "pnj": "pnj", "personnage": "pnj",
    "combat": "combat", "rencontre": "combat",
}


def plier(texte: str) -> str:
    t = unicodedata.normalize("NFKD", texte or "")
    t = "".join(c for c in t if not 0x300 <= ord(c) <= 0x36F)
    return " ".join(t.lower().split())


def resserrer(texte: str) -> str:
    return " ".join((texte or "").split())


def lire_consigne(contenu: str) -> tuple[str, str]:
    """Le genre et les indications d'une consigne. Sans genre reconnu, tout le contenu est l'indication d'une carte blanche."""
    tete = TETE.match(contenu)
    if tete and plier(tete.group(1)) in ALIAS:
        return ALIAS[plier(tete.group(1))], tete.group(2).strip()
    return "rediger", contenu.strip()


def cle(genre: str, indications: str) -> str:
    return f"{genre}|{resserrer(indications)}"


def reference(cle_consigne: str, rang: int) -> str:
    return hashlib.sha1(f"{cle_consigne}#{rang}".encode()).hexdigest()[:6]


def en_bloc(texte: str, debut: int, fin: int) -> bool:
    """Seule sur sa ligne : elle tient lieu de paragraphe ; sinon elle est prise dans une phrase."""
    avant = texte[texte.rfind("\n", 0, debut) + 1:debut]
    fin_ligne = texte.find("\n", fin)
    apres = texte[fin:fin_ligne if fin_ligne >= 0 else len(texte)]
    return not avant.strip() and not apres.strip()


def consignes_du_texte(texte: str) -> list[dict]:
    sortie = []
    for m in CONSIGNE.finditer(texte or ""):
        genre, indications = lire_consigne(m.group(1))
        sortie.append({"genre": genre, "indications": indications, "cle": cle(genre, indications),
                       "debut": m.start(), "fin": m.end(), "bloc": en_bloc(texte, m.start(), m.end())})
    return sortie


def consignes_du_scenario(scenario: dict) -> list[dict]:
    """Toutes les consignes du document, dans l'ordre, avec leur rang parmi les identiques et leur référence."""
    rangs: dict[str, int] = {}
    sortie = []
    for numero, chapitre in enumerate(scenario.get("chapitres") or [], start=1):
        for c in consignes_du_texte(chapitre.get("texte") or ""):
            rangs[c["cle"]] = rangs.get(c["cle"], 0) + 1
            c.update(rang=rangs[c["cle"]], ref=reference(c["cle"], rangs[c["cle"]]),
                     chapitre={"id": chapitre.get("id"), "titre": chapitre.get("titre") or "", "numero": numero})
            sortie.append(c)
    return sortie


def proposition_de(scenario: dict, consigne: dict):
    for r in reversed(scenario.get("reponses") or []):
        if r.get("cle") == consigne["cle"] and r.get("rang") == consigne["rang"] and r.get("statut") == "proposee":
            return r
    return None


def contexte(texte: str, debut: int, fin: int, largeur: int = 700) -> tuple[str, str]:
    avant = texte[max(0, debut - largeur):debut]
    apres = texte[fin:fin + largeur]
    if debut > largeur:
        avant = "…" + avant[avant.find(" ") + 1:]
    if fin + largeur < len(texte):
        apres = apres[:apres.rfind(" ")] + "…"
    return avant, apres
