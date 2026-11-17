r"""Les noms que les joueurs ne doivent pas connaître (le vrai nom de l'auberge de la campagne et son surnom).

Tout ce qui part vers la TV, et tout texte écrit par le modèle de langue, passe par masquer() : le nom caché
devient « l'auberge », quelle que soit sa graphie (accents, majuscules, tirets, guillemets, « P'tite », caractères
invisibles collés depuis un PDF, mot coupé : « Fan frelée », « Fanfre-lée », « F.anfrelée »). Le MJ peut choisir un autre
nom pour les joueurs (« l'auberge de Garin ») : réglage de l'onglet Table, posé par regler_nom_public().

Les noms cachés ne sont pas dans le code : ils viennent de data/noms-caches.json, une donnée de l'atelier que règle le MJ
(docs/campagne.md). Un pack de campagne ne les porte pas : une image construite sans pack ne doit jamais les dévoiler.
Sans ce fichier, rien n'est masqué. Le fichier est une liste ; chaque entrée est un objet, par exemple
[{"nom": "la Petite Fanfrelée"}, {"motif": "\\bjamais{sep}ne{sep}dort", "lettres": "jamaisnedort"}] :
  - "nom" : le nom tel qu'on l'écrit. L'article du début tombe ; chaque mot se reconnaît avec ou sans accents ni
    majuscules, même coupé ou truffé d'invisibles, les mots séparés par des espaces, des tirets ou des apostrophes. Le
    remplacement reprend l'article et la préposition qui le précèdent quand ce sont « la » ou « l' » (« à la », « de l' »,
    « chez la ») : le masque est fait pour un nom féminin ou élidé.
  - ou "motif", pour un nom aux variantes plus libres (« P'tite » pour « Petite », un pluriel, un mot collé à celui
    d'avant) : une expression rationnelle en minuscules, faite de lettres, de groupes (?:…), d'alternatives |,
    de classes […], de ? * +, de \b et \s, et de {sep} entre deux mots (espaces, tirets, apostrophes, invisibles). Chaque
    voyelle nue y accepte ses accents, et une coupure entre deux lettres (« Fan frelée ») est reconnue. Dans le JSON, la
    barre oblique inverse se double : "\\b".
  - "lettres" (facultatif) : des lettres sans accents que le nom choisi par le MJ pour les joueurs ne doit pas contenir,
    même réduit à ses seules lettres (« fanfrel ») ; avec "nom", par défaut, les lettres du nom sans son article.
  - "remplacement" (facultatif) : « auberge » par défaut, c'est-à-dire le nom que lisent les joueurs ; un autre mot
    s'écrit tel quel, précédé de « l' ».
Le fichier est relu quand il change (au plus RELIRE secondes après) ; recharger() le relit tout de suite. Illisible ou
faux au démarrage, il arrête l'atelier (masquer sans lui laisserait passer le nom) ; changé en cours de route et faux, il
est signalé au journal et la liste d'avant reste en place.

Les autres secrets (PNJ et lieux encore inconnus, peuple caché d'un aventurier) ne sont pas masqués : secrets_dans()
les retrouve dans un texte pour que l'atelier avertisse le MJ avant l'envoi.
"""
import json
import logging
import re
import threading
import time
import unicodedata

from api import config

FICHIER_NOMS_CACHES = config.DONNEES / "noms-caches.json"
RELIRE = 2.0  # secondes entre deux regards sur le fichier : masquer() est appelé pour chaque texte public
journal = logging.getLogger("atelier")

# Invisibles à l'écran : trait d'union conditionnel, espaces et liants de largeur nulle, marques de sens d'écriture,
# indicateur d'ordre des octets. Entre deux lettres, un invisible peut couper un mot (Fan|frelée) ou séparer deux mots sans
# espace visible (Petite|Fanfrelée) : le filtre accepte les deux lectures.
INV = "\u00ad\u034f\u180e\u200b-\u200f\u2060-\u2064\ufeff"
INVISIBLES = re.compile(f"[{INV}]")
# Ceux qui ne servent qu'à l'intérieur d'un mot : trait d'union conditionnel, liants, marques de sens d'écriture.
DANS_UN_MOT = re.compile("[\u00ad\u034f\u200d-\u200f]")
# Un invisible entre une lettre et son accent empêcherait de recomposer « é ».
AVANT_ACCENT = re.compile(f"[{INV}]+(?=[\u0300-\u036f])")
# Une suite d'invisibles compte pour un seul : la recherche reste rapide m\u00eame sur un texte truff\u00e9.
SUITE_INVISIBLE = re.compile(f"([{INV}])[{INV}]+")
ESP = rf"[\s{INV}]"  # une espace, visible ou non
SEP = rf"[\s  \-‐‑‒–—_'’{INV}]+"
# Une coupure glissée entre deux lettres d'un même mot (« Fan frelée », « Fanfre-lée », « F.anfrelée », un mot coupé en
# fin de ligne) : trois signes au plus, ni virgule ni point-virgule. Aucun mot ordinaire ne s'écrit avec toutes les
# lettres du nom caché ainsi séparées.
COUPE = rf"(?:[\s  .\-‐‑‒–—_·•'’*{INV}]{{1,3}})?"
ACCENTS = {"a": "aàâäáã", "e": "eéèêë", "i": "iîïí", "o": "oôöó", "u": "uùûüú", "c": "cç"}


def _souple(motif: str) -> str:
    """Rend un motif insensible aux accents (chaque voyelle nue accepte ses variantes accentuées), aux invisibles glissés
    dans un mot (chaque lettre peut être suivie d'invisibles) et aux coupures entre deux lettres qui se suivent (COUPE)."""
    sortie, i, apres_lettre = [], 0, False
    while i < len(motif):
        ch = motif[i]
        if ch == "[":
            fin = motif.index("]", i) + 1
            atome, i = motif[i:fin], fin
        elif ch == "\\":
            if motif[i + 1] != "s":
                sortie.append(motif[i:i + 2])  # \b
                i += 2
                apres_lettre = False
                continue
            atome, i = ESP, i + 2
        elif ch.isalpha():
            atome, i = f"[{ACCENTS[ch]}]" if ch in ACCENTS else ch, i + 1
        else:
            sortie.append(ch)  # groupes, alternatives, séparateur
            i += 1
            apres_lettre = False
            continue
        quantite = motif[i] if i < len(motif) and motif[i] in "?*+" else ""
        i += len(quantite)
        lettre = atome != ESP
        if lettre:
            coupe = COUPE if apres_lettre else ""
            atome = f"(?:{coupe}{atome}[{INV}]*)" if quantite else f"{coupe}{atome}[{INV}]*"
        sortie.append(atome + quantite)
        apres_lettre = lettre
    return "".join(sortie)


def _motif(nom: str) -> re.Pattern:
    nom = _souple(nom.replace("{sep}", "\x00")).replace("\x00", SEP)
    return re.compile(
        # « l'auberge « Jamais ne dort » » : le mot « auberge » est déjà écrit juste avant (ou avant une virgule).
        rf"(?:(?P<deja>\bauberge)(?P<ponct>(?:[^\S\n]|[{INV}])*(?:[,:]{ESP}*)?))?"
        rf"(?P<prefixe>(?:\b(?P<prep>à|de|du|chez){ESP}+)?(?:\b(?P<art>la|l['’]){ESP}*)?)"
        rf"(?P<auberge>auberge{ESP}+(?:de{ESP}+la|de|du){ESP}+)?"
        rf"(?:[«\"“]{ESP}*)?(?P<nom>{nom})\b(?:{ESP}*[»\"”])?"
        # « à la Petite Fanfrelée, l'auberge de Garin » : l'apposition du MJ dit déjà ce qu'est le lieu.
        rf"(?P<appo>{ESP}*,{ESP}*(?P<appo_art>l['’]){ESP}*(?=auberge\b))?",
        re.IGNORECASE,
    )


# Les noms cachés lus dans data/noms-caches.json (recharger) : (motif, remplacement), leurs motifs compilés, et les
# lettres que le nom public ne doit pas contenir. Vides tant que rien n'est lu : rien n'est masqué.
NOMS_CACHES: tuple = ()
MOTIFS: tuple = ()
LETTRES_DU_NOM_CACHE: tuple = ()
_LU = {"cle": None, "regard": 0.0}
_RELECTURE = threading.Lock()


def motif_du_nom(nom: str) -> str:
    r"""Le motif d'un nom écrit en clair : sans article, mot à mot, chaque mot entier (« la Petite Fanfrelée » :
    \bpetite{sep}fanfrelee)."""
    mots = forme_simple(ARTICLE.sub("", nom)).split()
    return r"\b" + "{sep}".join(mots) if mots else ""


def lire_noms_caches(contenu) -> tuple[tuple, tuple, tuple]:
    """(noms, motifs compilés, lettres) d'après le contenu du fichier ; ValueError s'il n'a pas la forme attendue."""
    if not isinstance(contenu, list):
        raise ValueError("le fichier doit contenir une liste d'entrées")
    noms, motifs, lettres = [], [], []
    for rang, e in enumerate(contenu, 1):
        if not isinstance(e, dict) or not any(isinstance(e.get(k), str) and e[k].strip() for k in ("nom", "motif")):
            raise ValueError(f"entrée {rang} : un objet avec « nom » ou « motif » est attendu")
        if any(k in e and not isinstance(e[k], str) for k in ("nom", "motif", "lettres", "remplacement")):
            raise ValueError(f"entrée {rang} : « nom », « motif », « lettres » et « remplacement » sont des textes")
        motif = e["motif"] if isinstance(e.get("motif"), str) and e["motif"].strip() else motif_du_nom(e["nom"])
        if not re.search(r"[a-z0-9]", motif):
            raise ValueError(f"entrée {rang} : le nom n'a aucune lettre")
        mot = e.get("remplacement") or "auberge"
        try:
            reconnu = _motif(motif)
        except (re.error, ValueError, IndexError, KeyError) as err:
            raise ValueError(f"entrée {rang} : motif illisible ({err})") from err
        noms.append((motif, mot))
        motifs.append((reconnu, mot))
        l = e["lettres"] if "lettres" in e else (lettres_seules(ARTICLE.sub("", e["nom"])) if e.get("nom") else "")
        if lettres_seules(l):
            lettres.append(lettres_seules(l))
    return tuple(noms), tuple(motifs), tuple(lettres)


def recharger(strict: bool = False) -> None:
    """Relit data/noms-caches.json. Absent : rien n'est masqué. Faux : ValueError si `strict` (au démarrage), sinon une
    erreur au journal et la liste d'avant reste."""
    global NOMS_CACHES, MOTIFS, LETTRES_DU_NOM_CACHE
    with _RELECTURE:
        try:
            st = FICHIER_NOMS_CACHES.stat()
            cle = (st.st_mtime_ns, st.st_size)
        except OSError:
            cle = None
        try:
            lu = lire_noms_caches(json.loads(FICHIER_NOMS_CACHES.read_text(encoding="utf-8"))) if cle else ((), (), ())
        except (OSError, ValueError) as err:
            if strict:
                raise ValueError(f"{FICHIER_NOMS_CACHES} : {err}") from err
            journal.error("Noms cachés non relus, la liste d'avant reste en place : %s : %s", FICHIER_NOMS_CACHES, err)
        else:
            NOMS_CACHES, MOTIFS, LETTRES_DU_NOM_CACHE = lu
        _LU["cle"], _LU["regard"] = cle, time.monotonic()


def _a_jour() -> None:
    """Un regard sur le fichier toutes les RELIRE secondes au plus : relu s'il a changé (ou apparu, ou disparu)."""
    if time.monotonic() - _LU["regard"] < RELIRE:
        return
    try:
        st = FICHIER_NOMS_CACHES.stat()
        cle = (st.st_mtime_ns, st.st_size)
    except OSError:
        cle = None
    _LU["regard"] = time.monotonic()
    if cle != _LU["cle"]:
        recharger()


def motifs() -> tuple:
    _a_jour()
    return MOTIFS


def lettres_cachees() -> tuple:
    _a_jour()
    return LETTRES_DU_NOM_CACHE


# Le nom que lisent les joueurs à la place du nom caché : « l'auberge » tant que le MJ n'en a pas choisi un autre. Son
# article se lie à « à » et à « de » : « à l'auberge de Garin », « au Chaudron », « de la Taverne », « chez Garin »,
# « du Bouclier » pour l'enseigne « Au Bouclier ».
NOM_PAR_DEFAUT = "l'auberge"
ARTICLE_DU_NOM = re.compile(r"^(l['’]|(?:le|la|les|au|aux|chez) )", re.IGNORECASE)
AVEC_A = {"l'": "à l'", "l’": "à l’", "le ": "au ", "la ": "à la ", "les ": "aux ", "au ": "au ", "aux ": "aux ", "chez ": "chez ", "": "à "}
AVEC_DE = {"l'": "de l'", "l’": "de l’", "le ": "du ", "la ": "de la ", "les ": "des ", "au ": "du ", "aux ": "des ", "chez ": "de chez ", "": "de "}
INTERDITS_DU_NOM = re.compile(r"[<>{}\[\]\\|`#@*=+^~$%&/\n\r\t]")
_nom_public = ("l'", "auberge")
# Le nom choisi, réduit à ses seules lettres, ne doit pas contenir le vrai (LETTRES_DU_NOM_CACHE) : ni coupé par des
# espaces, des tirets ou des points (« Fan frelée », « F.a.n.f.r.e.l.é.e »), ni écrit avec des chiffres ou des lettres d'un
# autre alphabet qui ressemblent aux nôtres (« F4nfrelée », un « а » cyrillique).
SOSIES = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "а": "a", "в": "b", "е": "e",
                        "к": "k", "м": "m", "н": "h", "о": "o", "р": "p", "с": "c", "т": "t", "у": "y", "х": "x", "і": "i",
                        "ј": "j", "ѕ": "s", "ӏ": "l", "α": "a", "ε": "e", "ι": "i", "κ": "k", "ν": "v", "ο": "o", "ρ": "p",
                        "τ": "t", "υ": "u"})


def lettres_seules(texte: str) -> str:
    """Les lettres d'un texte, sans accents ni casse, chiffres et sosies lus comme les lettres qu'ils imitent."""
    t = unicodedata.normalize("NFKD", INVISIBLES.sub("", texte)).lower().translate(SOSIES)
    return "".join(c for c in t if c.isalpha() and not unicodedata.combining(c))


def nom_valide(nom) -> str:
    """Le nom choisi par le MJ pour les joueurs, espaces resserrées, ou "" (le nom par défaut). ValueError s'il est trop
    long, s'il porte ce qu'un nom n'a pas, ou s'il contient lui-même le nom caché."""
    t = " ".join(INVISIBLES.sub("", nom if isinstance(nom, str) else "").split())
    if not t:
        return ""
    if len(t) > 60:
        raise ValueError("Le nom de l'auberge tient en soixante caractères au plus.")
    if INTERDITS_DU_NOM.search(t) or not re.search(r"[^\W\d_]", t):
        raise ValueError("Le nom de l'auberge s'écrit avec des lettres, des espaces et des apostrophes.")
    if contient_nom_cache(t) or any(m in lettres_seules(t) for m in lettres_cachees()):
        raise ValueError("Ce nom contient le vrai nom de l'auberge : les joueurs le liraient.")
    return t


def regler_nom_public(nom) -> str:
    """Pose le nom que lisent les joueurs ("" ou un nom refusé : « l'auberge ») ; rend le nom posé."""
    global _nom_public
    try:
        t = nom_valide(nom) or NOM_PAR_DEFAUT
    except ValueError:
        t = NOM_PAR_DEFAUT
    m = ARTICLE_DU_NOM.match(t)
    _nom_public = (m.group(1).lower(), t[m.end():]) if m and t[m.end():] else ("", t)
    return nom_public()


def nom_public() -> str:
    return "".join(_nom_public)


def _debut_de_phrase(texte: str, i: int) -> bool:
    avant = INVISIBLES.sub("", texte[:i]).rstrip()
    return not avant or avant[-1] in ".!?…:«\n"


def preparer(texte: str) -> str:
    """En forme composée : un « é » écrit en deux caractères (e + accent) ne doit pas échapper au filtre. Les invisibles
    restent pendant la recherche (les motifs les acceptent) : retirés plus tôt, ils colleraient deux mots."""
    return unicodedata.normalize("NFC", AVANT_ACCENT.sub("", SUITE_INVISIBLE.sub(r"\1", texte)))


def _remplacement(m: re.Match, mot: str, debut: int) -> str:
    prep = (m.group("prep") or "").lower()
    article, reste = _nom_public if mot == "auberge" else ("l'", mot)
    if m.group("auberge") and not m.group("art"):
        # « auberge de la Petite Fanfrelée » sans article devant : on garde « auberge ».
        r = mot
    elif prep in ("à", "chez"):
        r = AVEC_A[article] + reste
    elif prep in ("de", "du"):
        r = AVEC_DE[article] + reste
    else:
        r = article + reste
    if _debut_de_phrase(m.string, debut) or (m.string[debut:debut + 1].isupper() and m.group("prefixe")):
        r = r[:1].upper() + r[1:]
    return r


def masquer(texte):
    if not isinstance(texte, str) or not texte:
        return texte
    texte = preparer(texte)
    for motif, mot in motifs():
        def remplacer(m, mot=mot):
            appo = m.group("appo") or ""
            prep = (m.group("prep") or "").lower()
            if appo and not m.group("deja") and prep in ("à", "chez", "de", "du"):
                # « à la Petite Fanfrelée, l'auberge de Garin » devient « à l'auberge de Garin » : le nom tombe avec sa
                # virgule, l'apposition reste (son « auberge » suit la correspondance).
                r = ("de " if prep in ("de", "du") else "à ") + m.group("appo_art")
                return r[:1].upper() + r[1:] if m.string[m.start():m.start() + 1].isupper() else r
            if not m.group("deja"):
                return _remplacement(m, mot, m.start()) + appo
            suite = INVISIBLES.sub("", m.string[m.end():]).lstrip()
            if not m.group("ponct").strip() or not suite or suite[0] in ",.;:!?…)»":
                # « l'auberge « Jamais ne dort » », « l'auberge, la Petite Fanfrelée, » : le mot reste, seul.
                r = m.group("deja")
                return (r[:1].upper() + r[1:] if _debut_de_phrase(m.string, m.start()) else r) + appo
            # « une auberge, la Fanfrelée brûlait » : la virgule n'ouvre pas une apposition, seul le nom change.
            return m.group("deja") + m.group("ponct") + _remplacement(m, mot, m.start("prefixe")) + appo
        texte = motif.sub(remplacer, texte)
    # Plus d'invisible dans un texte public : l'écran affiche la même chose.
    return INVISIBLES.sub("", texte)


def contient_nom_cache(texte) -> bool:
    return isinstance(texte, str) and any(motif.search(preparer(texte)) for motif, _ in motifs())


# ---------------------------------------------------------------- les autres secrets (PNJ, lieux, peuples)

ARTICLE = re.compile(r"^\s*(?:l['’]\s*|(?:le|la|les)\s+)", re.IGNORECASE)
# Mots d'un nom trop courants pour le désigner seuls (« Frère » Anatole, « Nouveau » PNJ, « de la » maison…).
MOTS_COMMUNS = frozenset("""de du des la le les et en au aux sur sous von van der den di da of the frere soeur pere mere
    maitre maitresse dame sire messire seigneur capitaine saint sainte nouveau nouvelle vieux vieille petit petite grand
    grande pnj""".split())


def forme_simple(texte, espacer=False) -> str:
    """Pour comparer des noms : sans invisible, sans accents ni casse, toute ponctuation devenue une espace. Avec
    `espacer`, un invisible qui peut séparer deux mots devient une espace (Basile|Varenne)."""
    t = texte if isinstance(texte, str) else ""
    t = INVISIBLES.sub(" ", DANS_UN_MOT.sub("", t)) if espacer else INVISIBLES.sub("", t)
    t = unicodedata.normalize("NFKD", t).lower()
    t = "".join(c for c in t.replace("œ", "oe").replace("æ", "ae") if not unicodedata.combining(c))
    return " ".join(re.sub(r"[\W_]+", " ", t).split())


def mots_du_nom(nom) -> set[str]:
    return set(forme_simple(nom).split())


def formes_du_nom(nom, surnom="", mots=False, deja_connus=frozenset()) -> set[str]:
    """Les formes sous lesquelles un nom secret se reconnaît dans un texte : le nom entier et le surnom, sans article ;
    avec `mots`, chaque mot propre du nom (« Basile » pour Basile Varenne), sauf un mot courant ou déjà porté par un nom
    connu des joueurs (« Varenne », si Lisette Varenne est connue)."""
    formes = {forme_simple(ARTICLE.sub("", n)) for n in (nom, surnom) if isinstance(n, str)}
    if mots and isinstance(nom, str):
        for mot in re.split(r"[\s\-‐‑'’]+", ARTICLE.sub("", nom)):
            f = forme_simple(mot)
            if mot[:1].isupper() and len(f) >= 3 and " " not in f and f not in MOTS_COMMUNS and f not in deja_connus:
                formes.add(f)
    return {f for f in formes if f}


def secrets_dans(texte, candidats) -> list:
    """Les candidats (secret, formes) dont une forme figure dans le texte, mot pour mot, sans accents ni casse. Le texte
    est lu deux fois : invisibles retirés (Bas|tien), puis devenus des espaces (Basile|Varenne)."""
    lectures = [f" {forme_simple(texte)} ", f" {forme_simple(texte, espacer=True)} "]
    return [secret for secret, formes in candidats if any(f" {f} " in t for t in lectures for f in formes)]


# Champs qui ne contiennent jamais de texte lisible : on ne les parcourt pas (grilles, adresses, identifiants).
SANS_TEXTE = frozenset({"id", "url", "illustration", "illustrations", "terrain", "brouillard", "brume", "feu", "sol", "piece",
                        "murs", "camera", "modifie", "version", "couleur", "image", "fond", "ref", "cle"})


def masquer_tout(valeur, cle=None):
    """Applique masquer() à toutes les chaînes d'une réponse publique, sauf dans les champs sans texte."""
    if cle in SANS_TEXTE:
        return valeur
    if isinstance(valeur, str):
        return masquer(valeur)
    if isinstance(valeur, dict):
        return {k: masquer_tout(v, k) for k, v in valeur.items()}
    if isinstance(valeur, list):
        return [masquer_tout(v, cle) for v in valeur]
    return valeur


def exemples_du_nom_public() -> list[str]:
    """Le nom que lisent les joueurs dans trois phrases (seul, après « à », après « de ») : ce que l'onglet Table montre au
    MJ, sans avoir à écrire le nom caché. Les mêmes que masquer() ferait de « La Petite Fanfrelée », « Ils ont dormi à la
    Petite Fanfrelée. » et « Le comptoir de la Petite Fanfrelée »."""
    article, reste = _nom_public
    seul = article + reste
    return [seul[:1].upper() + seul[1:], f"Ils ont dormi {AVEC_A[article]}{reste}.", f"Le comptoir {AVEC_DE[article]}{reste}"]


# Au chargement : un fichier faux arrête l'atelier plutôt que de laisser passer le nom.
recharger(strict=True)
