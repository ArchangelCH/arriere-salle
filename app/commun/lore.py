"""Le lore du personnage, partagé par le coin des joueurs et l'atelier : le joueur étoffe l'histoire de son héros
depuis le coin (son passé, ce qui le pousse, ses contacts, ses particularités), puis l'envoie au MJ, qui accepte, retouche
ou refuse chaque passage. Le texte du MJ n'est jamais écrasé sans son accord.

- Les passages permis sont ceux du récit de « Mon héros » (CHAMPS, le RECIT_DU_HEROS de main.py), jamais un secret, une
  note du MJ, la progression ni le lien avec un autre héros. Mêmes bornes que la fiche (carnet.LONG).
- Le brouillon vit dans propositions/lore/<joueur>.json, écrit par le coin seul et sous verrou : le joueur écrit à son
  rythme, chaque passage avec le texte de la fiche qu'il lisait en commençant (base).
- « Envoyer au MJ » en fait une demande « lore » {ref, champs: {cle: {avant, apres}}}, en attente du MJ. avant : ce que
  le joueur lisait ; l'atelier le compare à ce que la fiche publierait aujourd'hui, et le dit au MJ si elle a changé.
  Un seul envoi attend à la fois : un nouvel envoi remplace le précédent (retiré par le joueur).
- Les passages que le carnet garde (vidés parce qu'ils nomment un inconnu, ou changés par le masque) sont publiés dans
  « tenus » : le coin ne les montre qu'en lecture seule et n'en envoie rien.
- Le MJ tranche passage par passage ; l'atelier note l'issue de chacun dans la demande (« issue » : acceptee, retouchee,
  refusee), que le coin relit pour dire au joueur ce qu'il en est. Le texte retouché ne repart pas par là : le joueur le
  lit dans sa fiche publiée, passée au masque et à retenir comme le reste.

Ce module ne lit rien de l'atelier : joueurs.py et lore_mj.py l'importent tous deux, les bornes et la validation sont les
mêmes des deux côtés, et rien n'y dépend d'un secret du MJ.
"""
import json
import re
import unicodedata
from contextlib import contextmanager
from pathlib import Path

from commun import carnet
from commun import demandes
from commun.demandes import Genre, Refus
from commun import stockage

GENRE = "lore"
DOSSIER = "lore"
VERROU = ".verrou"
CHAMPS = ("histoire", "avant", "pourquoi", "jamais", "allure", "defaut", "lien", "contacts", "particularites")
LONG = carnet.LONG  # signes d'un passage, comme la fiche
# Le texte publié que le joueur lisait : le masque peut allonger un nom (le nom de l'auberge choisi par le MJ).
VU_MAX = 2 * LONG
# Un envoi, avec le texte d'avant de chaque passage : il doit tenir dans la file du joueur (demandes.OCTETS_MAX) avec ses
# autres demandes.
ENVOI_OCTETS_MAX = 96 * 1024
ECRITURE_OCTETS_MAX = 160 * 1024  # une requête d'enregistrement du brouillon
BROUILLON_OCTETS_MAX = 640 * 1024
HISTORIQUE_MAX = 6  # envois traités que la page rappelle
REF = re.compile(r"^[a-f0-9]{20}$")
ISSUES = ("acceptee", "retouchee", "refusee")

# (clé, groupe, titre pour le joueur, aide, titre pour le MJ). « {a|b} » s'accorde au genre du héros (b : féminin).
PASSAGES = (
    ("histoire", "qui", "Qui je suis", "Trois ou quatre phrases : ce que tout le monde lit en tête de votre fiche.",
     "L'histoire, en tête de fiche"),
    ("avant", "passe", "Qui étiez-vous avant ?", "Garde de caravane, apprentie d'un mage, novice d'une Église…",
     "Qui {il|elle} était avant"),
    ("pourquoi", "passe", "Pourquoi être devenu{|e} aventuri{er|ère} ?", "Une dette, un nom à laver, un village qui vous craint…",
     "Pourquoi {il|elle} est parti{|e} à l'aventure"),
    ("jamais", "passe", "Ce que vous ne ferez jamais", "Abandonner un compagnon, livrer quelqu'un à une Église…",
     "Ce qu'{il|elle} ne fera jamais"),
    ("allure", "allure", "Votre allure", "La TV la montre à toute la tablée, avec votre portrait.",
     "Allure, montrée à la TV"),
    ("defaut", "allure", "Un défaut visible", "Ce que les autres remarquent vite, et qui peut vous jouer des tours.",
     "Défaut visible"),
    ("lien", "liens", "Le lien avec le groupe", "Une dette, un souvenir, une rivalité avec un autre héros de la tablée.",
     "Lien avec le groupe"),
    ("contacts", "liens", "Contacts, dettes et ennemis", "Des noms, des lieux : votre MJ décide de ce qui existe dans son monde.",
     "Contacts, dettes et ennemis"),
    ("particularites", "traits", "Particularités", "Votre MJ les décide : proposez-lui les vôtres, en bien ou en mal.",
     "Particularités"),
)
GROUPES = {"qui": "Qui {il|elle} est", "passe": "D'où {il|elle} vient", "allure": "Comment on {le|la} voit",
           "liens": "Ceux qu'{il|elle} connaît", "traits": "Ce qui {le|la} distingue"}
assert tuple(p[0] for p in PASSAGES) == CHAMPS

RIEN = "Rien à envoyer : vos passages sont ceux de votre fiche."
TROP = ("Cet envoi est trop long pour partir d'un coup. Envoyez d'abord une partie de vos passages (revenez au texte de la "
        "fiche pour les autres, le temps que votre MJ lise), puis le reste.")
TENU = "Votre MJ garde ce passage pour l'instant."
AUTRE_HEROS = "Votre héros a changé depuis : la page se relit."


def accord(texte: str, genre) -> str:
    """« devenu{|e} » : la première forme au masculin, la seconde au féminin."""
    return re.sub(r"\{([^{}|]*)\|([^{}|]*)\}", lambda m: m.group(2) if genre == "f" else m.group(1), texte)


def nom(cle: str, genre=None, mj: bool = False) -> str:
    p = next(x for x in PASSAGES if x[0] == cle)
    return accord(p[4] if mj else p[2], genre)


def brut(valeur) -> str:
    """Le texte tel que le joueur le tape, pour son brouillon : sans retour chariot ni caractère de contrôle, mais avec
    ses espaces (le curseur ne saute pas pendant qu'il écrit)."""
    if not isinstance(valeur, str):
        raise Refus(400, "Ce texte est illisible.")
    t = valeur.replace("\r\n", "\n").replace("\r", "\n").replace("\t", " ")
    return "".join(c for c in t if c == "\n" or unicodedata.category(c)[0] != "C")


def propre(valeur, quoi: str = "Ce passage") -> str:
    """Le texte d'un passage tel qu'il part vers le MJ, puis vers la fiche : en forme composée, sans caractère de contrôle
    ni invisible, chaque ligne sans espace au bout, deux sauts de ligne au plus. Trop long, il est refusé plutôt que coupé.
    Repasser un texte propre ne le change pas."""
    t = unicodedata.normalize("NFC", brut(valeur))
    t = "\n".join(ligne.rstrip() for ligne in t.split("\n"))
    t = re.sub(r"\n{3,}", "\n\n", t).strip()
    if len(t) > LONG:
        raise Refus(413, f"{quoi} est trop long : {LONG} signes au plus.")
    return t


def taille(contenu) -> int:
    return len(json.dumps(contenu, ensure_ascii=False, separators=(",", ":")).encode())


def valider_lore(corps) -> dict:
    """{ref, champs: {cle: {avant, apres}}} : ref, le jeton du héros dans la compagnie publiée ; avant, le texte de la fiche
    que le joueur lisait ; apres, le sien. Seuls les passages du récit, dans l'ordre de la fiche, chacun vraiment changé."""
    corps = demandes.seulement(corps, {"ref", "champs"}, "L'histoire")
    ref = corps.get("ref")
    if not isinstance(ref, str) or not REF.match(ref):
        raise Refus(400, AUTRE_HEROS)
    champs = corps.get("champs")
    if not isinstance(champs, dict) or not champs:
        raise Refus(400, RIEN)
    interdits = sorted(str(k)[:30] for k in champs if k not in CHAMPS)
    if interdits:
        raise Refus(400, f"Ce passage ne s'écrit pas depuis le coin : {', '.join(interdits)}.")
    propres = {}
    for cle in CHAMPS:
        if cle not in champs:
            continue
        v = champs[cle]
        if not isinstance(v, dict) or set(v) != {"avant", "apres"} or not isinstance(v["avant"], str) or len(v["avant"]) > VU_MAX:
            raise Refus(400, "Un passage est illisible : la page se relit.")
        apres = propre(v["apres"], f"« {nom(cle)} »")
        if apres != v["avant"]:
            propres[cle] = {"avant": v["avant"], "apres": apres}
    if not propres:
        raise Refus(400, RIEN)
    propre_corps = {"ref": ref, "champs": propres}
    if taille(propre_corps) > ENVOI_OCTETS_MAX:
        raise Refus(413, TROP)
    return propre_corps


# L'histoire attend le MJ et le prévient ; carnet fermé, elle ne part pas (sa fiche n'est pas publiée).
demandes.enregistrer(Genre(GENRE, "L'histoire du héros", ("une histoire à relire", "{n} histoires à relire"), attente=True,
                           valider=valider_lore, carnet=True, oui="Lire", non="Tout refuser",
                           statuts={demandes.EN_ATTENTE: "envoyée, en attente du MJ", demandes.ACCEPTEE: "relue par le MJ",
                                    demandes.REFUSEE: "refusée par le MJ"}))


# ---------------------------------------------------------------- le brouillon

@contextmanager
def verrou(depot: Path):
    with stockage.verrou_de_dossier(depot / DOSSIER, VERROU):
        yield


def fichier(depot: Path, joueur: str) -> Path:
    if not isinstance(joueur, str) or not demandes.ID_JOUEUR.match(joueur):
        raise Refus(403, "Accès invalide")
    return depot / DOSSIER / f"{joueur}.json"


def vide() -> dict:
    return {"ref": None, "champs": {}, "modifie": None}


def lire_brouillon(depot: Path, joueur: str) -> dict:
    """Le brouillon d'un joueur ; un fichier abîmé, trop lourd ou absent vaut un brouillon vide, une entrée abîmée s'en va."""
    chemin = fichier(depot, joueur)
    try:
        if chemin.stat().st_size > BROUILLON_OCTETS_MAX:
            return vide()
        b = stockage.lire_json(chemin)
    except (OSError, ValueError):
        return vide()
    if not isinstance(b, dict):
        return vide()
    champs = {}
    for cle, e in (b.get("champs") or {}).items() if isinstance(b.get("champs"), dict) else ():
        if (cle in CHAMPS and isinstance(e, dict) and isinstance(e.get("texte"), str) and len(e["texte"]) <= LONG
                and isinstance(e.get("base"), str) and len(e["base"]) <= VU_MAX):
            champs[cle] = {"texte": e["texte"], "base": e["base"], "modifie": str(e.get("modifie") or "")}
    ref = b.get("ref") if isinstance(b.get("ref"), str) and REF.match(b["ref"]) else None
    return {"ref": ref, "champs": champs, "modifie": b.get("modifie") if isinstance(b.get("modifie"), str) else None}


def ecrire_brouillon(depot: Path, joueur: str, b: dict) -> None:
    """À appeler sous le verrou. Un brouillon sans passage s'efface."""
    chemin = fichier(depot, joueur)
    if not b.get("champs"):
        chemin.unlink(missing_ok=True)
        return
    if taille(b) > BROUILLON_OCTETS_MAX:
        raise Refus(413, "Votre brouillon est trop lourd : envoyez-en une partie à votre MJ d'abord.")
    chemin.parent.mkdir(parents=True, exist_ok=True)
    stockage.ecrire_json_compact(chemin, b, mode=0o600)


# ---------------------------------------------------------------- ce que le coin sait de la fiche publiée

def publies(heros: dict) -> dict:
    """Le récit de « Mon héros » tel que l'atelier l'a publié (au masque, sans ce qui nomme un inconnu)."""
    return {k: heros.get(k) if isinstance(heros.get(k), str) else "" for k in CHAMPS}


def tenus(heros: dict) -> set:
    return {k for k in heros.get("tenus") or [] if k in CHAMPS} if isinstance(heros.get("tenus"), list) else set()


def courant(b: dict, ref: str) -> dict:
    """Le brouillon de ce héros-ci : écrit pour un autre (le MJ a confié un autre héros au joueur), il ne compte plus."""
    return b if b.get("ref") == ref else vide() | {"ref": ref}


def enregistrer(b: dict, heros: dict, ref: str, textes: dict, effacer: list, relus: list, instant: str,
                bases: dict | None = None) -> dict:
    """Le brouillon après un enregistrement du joueur : ses passages tapés (textes), ceux qu'il abandonne pour revenir au
    texte de la fiche (effacer), ceux dont il a lu la nouvelle version de la fiche (relus : il part désormais d'elle). Un
    passage revenu au texte de la fiche s'en va ; un passage tenu ne se change pas, il ne peut que s'effacer. bases : le
    texte de la fiche que la page montrait quand le joueur a commencé un passage (sinon, celui publié maintenant) ; il ne
    sert qu'à dire au MJ si la fiche a changé depuis, un texte faux n'y gagne donc rien."""
    bases = {} if bases is None else bases
    if not all(isinstance(x, t) for x, t in ((textes, dict), (effacer, list), (relus, list), (bases, dict))):
        raise Refus(400, "Enregistrement illisible.")
    inconnus = sorted(str(k)[:30] for k in [*textes, *effacer, *relus, *bases] if k not in CHAMPS)
    if inconnus:
        raise Refus(400, f"Ce passage ne s'écrit pas depuis le coin : {', '.join(inconnus)}.")
    b = courant(b, ref)
    champs = dict(b["champs"])
    vus, gardes = publies(heros), tenus(heros)
    for cle in effacer:
        champs.pop(cle, None)
    for cle, valeur in textes.items():
        t = brut(valeur)
        if len(t) > LONG:
            raise Refus(413, f"« {nom(cle)} » est trop long : {LONG} signes au plus.")
        if propre(t) == vus[cle] and cle not in gardes:
            champs.pop(cle, None)
            continue
        if cle in gardes and champs.get(cle, {}).get("texte") != t:
            raise Refus(409, f"« {nom(cle)} » : {TENU}")
        base = bases.get(cle)
        e = champs.get(cle) or {"base": base if isinstance(base, str) and len(base) <= VU_MAX and cle not in gardes else vus[cle]}
        champs[cle] = {"texte": t, "base": e["base"], "modifie": instant}
    for cle in relus:
        if cle in champs and cle not in gardes:
            champs[cle] = champs[cle] | {"base": vus[cle]}
    return {"ref": ref, "champs": champs, "modifie": instant}


def lores(liste: list) -> list:
    return [d for d in liste if d.get("genre") == GENRE and isinstance((d.get("corps") or {}).get("champs"), dict)]


def en_attente(liste: list) -> list:
    return [d for d in lores(liste) if d["statut"] == demandes.EN_ATTENTE]


def apres_de(d: dict, cle: str) -> str | None:
    v = ((d.get("corps") or {}).get("champs") or {}).get(cle)
    return v["apres"] if isinstance(v, dict) and isinstance(v.get("apres"), str) else None


def issue_de(d: dict, cle: str) -> str | None:
    """Ce que le MJ a fait de ce passage : son issue notée, sinon le statut de toute la demande (un « Tout refuser » de
    la boîte, sans détail)."""
    issue = d.get("issue") if isinstance(d.get("issue"), dict) else {}
    if issue.get(cle) in ISSUES:
        return issue[cle]
    if d["statut"] == demandes.REFUSEE:
        return "refusee"
    if d["statut"] == demandes.ACCEPTEE:
        return "acceptee"
    return None


def etats(b: dict, heros: dict, ref: str, liste: list) -> dict:
    """Où en est chaque passage : {cle : {etat, entree, texte, dernier, issue, propose}}. etat : « fiche » (rien en
    cours), « brouillon », « envoye » (tel quel dans l'envoi qui attend), « a-renvoyer » (changé depuis), « refuse » (le
    texte que le MJ vient de refuser, pas retouché depuis). Un brouillon accepté ou retouché par le MJ a fait son œuvre :
    la fiche fait foi."""
    tous = lores(liste)
    ouvert = next((d for d in reversed(tous) if d["statut"] == demandes.EN_ATTENTE), None)
    traites = [d for d in reversed(tous) if d["statut"] in (demandes.ACCEPTEE, demandes.REFUSEE)]
    b = courant(b, ref)
    vus, gardes = publies(heros), tenus(heros)
    sortie = {}
    for cle in CHAMPS:
        e = b["champs"].get(cle)
        tenu = cle in gardes
        texte = propre(e["texte"]) if e else None
        dernier = next((d for d in traites if apres_de(d, cle) is not None), None)
        issue = issue_de(dernier, cle) if dernier else None
        propose = apres_de(dernier, cle) if dernier else None
        brouillon = bool(e) and (tenu or texte != vus[cle])
        if brouillon and issue in ("acceptee", "retouchee") and texte == propose and str(dernier.get("traitee") or "") >= e["modifie"]:
            brouillon = False
        etat = "fiche"
        if brouillon:
            envoye = apres_de(ouvert, cle) if ouvert else None
            etat = ("envoye" if envoye == texte else "a-renvoyer") if envoye is not None else (
                "refuse" if issue == "refusee" and texte == propose and str(dernier.get("traitee") or "") >= e["modifie"] else "brouillon")
        sortie[cle] = {"etat": etat, "entree": e if brouillon else None, "texte": texte if brouillon else None, "tenu": tenu,
                       "dernier": dernier, "issue": issue, "propose": propose}
    return {"passages": sortie, "ouvert": ouvert, "traites": traites}


def corps_envoi(b: dict, heros: dict, ref: str, liste: list) -> dict:
    """La demande que fait « Envoyer au MJ » : chaque passage du brouillon qui diffère de ce que le joueur lisait. Un
    passage tenu bloque l'envoi (le joueur l'efface d'abord) : rien ne part en silence, rien ne s'écrase. Un texte que le
    MJ vient de refuser ne repart pas de lui-même : le joueur le retouche d'abord."""
    vu = etats(b, heros, ref, liste)["passages"]
    champs = {}
    for cle in CHAMPS:
        x = vu[cle]
        if not x["entree"] or x["etat"] == "refuse":
            continue
        if x["tenu"]:
            raise Refus(409, f"« {nom(cle, heros.get('genre'))} » : {TENU} Effacez votre brouillon de ce passage pour envoyer le reste.")
        if x["texte"] != x["entree"]["base"]:
            champs[cle] = {"avant": x["entree"]["base"], "apres": x["texte"]}
    if not champs:
        raise Refus(400, RIEN)
    return valider_lore({"ref": ref, "champs": champs})


def meme_envoi(d: dict, corps: dict) -> bool:
    return (d.get("corps") or {}).get("champs") == corps["champs"] and (d.get("corps") or {}).get("ref") == corps["ref"]


# ---------------------------------------------------------------- ce que la page du joueur montre

def vue(b: dict, heros: dict | None, ref: str | None, liste: list, pause: bool) -> dict:
    """La page « L'histoire de mon héros » : chaque passage (le texte de la fiche, le brouillon, où en est l'envoi), l'envoi
    qui attend le MJ, et les derniers envois traités, passage par passage. Jamais le texte d'un passage tenu."""
    heros = heros or {}
    genre = heros.get("genre") if heros.get("genre") in ("h", "f") else ""
    tout = etats(b, heros, ref or "", liste)
    vus = publies(heros)
    passages = []
    for cle, groupe, _, aide, _ in PASSAGES:
        x = tout["passages"][cle]
        e, tenu, issue = x["entree"], x["tenu"], x["issue"]
        passages.append({
            "cle": cle, "groupe": groupe, "nom": nom(cle, genre), "aide": aide, "tenu": tenu, "etat": x["etat"],
            "publie": "" if tenu else vus[cle], "brouillon": e["texte"] if e else None, "modifie": e["modifie"] if e else None,
            # La fiche a changé depuis que le joueur a commencé ce passage : il le voit, et choisit d'en partir ou non.
            "change_depuis": bool(e and not tenu and e["base"] != vus[cle]),
            "dernier": {"issue": issue, "quand": x["dernier"].get("traitee"),
                        "propose": x["propose"] if issue == "retouchee" and not tenu else None} if issue else None})
    ouvert = tout["ouvert"]
    historique = [{"id": d["id"], "cree": d.get("cree"), "traitee": d.get("traitee"), "statut": d["statut"],
                   "statut_dit": demandes.statut_dit(d), "mot": d.get("mot") or "", "resultat": d.get("resultat") or "",
                   "passages": [{"cle": k, "nom": nom(k, genre), "issue": issue_de(d, k)} for k in CHAMPS if apres_de(d, k) is not None]}
                  for d in tout["traites"][:HISTORIQUE_MAX]]
    return {"ouvert": True, "pause": pause, "heros": {"nom": str(heros.get("nom") or "")[:120], "genre": genre},
            "groupes": {k: accord(v, genre) for k, v in GROUPES.items()}, "passages": passages, "max": LONG,
            "envoi": {"id": ouvert["id"], "cree": ouvert.get("cree"), "statut_dit": demandes.statut_dit(ouvert),
                      "passages": [{"cle": k, "nom": nom(k, genre)} for k in CHAMPS if apres_de(ouvert, k) is not None]} if ouvert else None,
            "historique": historique}
