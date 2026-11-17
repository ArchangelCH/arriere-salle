"""Les fichiers de l'atelier sous une adresse qui porte leur version : /static/v-<empreinte>/js/atelier.js.

Sans cela, chaque fichier de /static/ est servi « no-cache » : le navigateur redemande les 176 modules JS et les 40 feuilles
de l'atelier à chaque ouverture (246 requêtes de revalidation, 6 s sur un téléphone bridé). Les pages HTML reçoivent leurs
liens réécrits (réécrire_html) ; les modules s'importent entre eux par des chemins relatifs, qui restent sous le préfixe ; les
rares adresses absolues « /static/… » d'un script ou d'une feuille sont réécrites quand on les sert (reponse).

L'empreinte vient du nom, de la taille et de la date de chaque fichier : modifier un fichier change l'adresse de tous, et le
navigateur relit tout une fois. Une page ouverte avant une modification, qui demande encore l'ancienne empreinte, reçoit les
fichiers d'aujourd'hui sans cache (rien d'ancien ne reste collé). Les polices gardent leur adresse (30 jours)."""

import hashlib
import mimetypes
import posixpath
import re
import time

from starlette.responses import Response

from api import config
from commun import nom_campagne

STATIQUE = config.ICI / "static"
PREFIXE = re.compile(r"^/static/v-([0-9a-f]{10})/(.+)$")
# Une adresse absolue d'un fichier versionné, dans un script, une feuille ou une page : ni une police, ni une adresse déjà versionnée.
ABSOLUE = re.compile(r"(?<![\w./-])/static/(?!v-[0-9a-f]{10}/|fonts/)")
LIENS_HTML = re.compile(r'((?:href|src)=")/static/(?!fonts/|v-[0-9a-f]{10}/)')
TYPES_REECRITS = {".js", ".css", ".html", ".mjs"}
IMMUABLE = "{portee}, max-age=31536000, immutable"
_version: dict = {"quand": 0.0, "valeur": ""}
_reecrits: dict = {}


def version() -> str:
    """L'empreinte de ce qui est servi sous /static/ (hors polices). Recalculée au plus toutes les deux secondes."""
    maintenant = time.monotonic()
    if _version["valeur"] and maintenant - _version["quand"] < 2.0:
        return _version["valeur"]
    h = hashlib.sha1()
    for chemin in sorted(STATIQUE.rglob("*")):
        try:
            if chemin.is_file() and "fonts" not in chemin.relative_to(STATIQUE).parts[:1]:
                st = chemin.stat()
                h.update(f"{chemin.relative_to(STATIQUE)}|{st.st_size}|{st.st_mtime_ns}\n".encode())
        except OSError:
            continue
    _version.update(quand=maintenant, valeur=h.hexdigest()[:10])
    return _version["valeur"]


def reecrire_texte(texte: str, v: str | None = None) -> str:
    # Les polices gardent leur adresse d'origine (30 jours, préchargées par les pages) : la feuille ne les redemande pas sous l'empreinte.
    texte = texte.replace("../fonts/", "/static/fonts/")
    return ABSOLUE.sub(f"/static/v-{v or version()}/", texte)


def reecrire_html(texte: str) -> str:
    """Les liens « /static/… » d'une page HTML, sous l'empreinte du moment (polices exceptées), et le nom de la campagne."""
    return LIENS_HTML.sub(rf"\1/static/v-{version()}/", nom_campagne.nommer(texte))


def decouper(chemin: str) -> tuple[str, bool] | None:
    """(chemin sans le préfixe, l'empreinte est-elle celle du moment ?), ou None si l'adresse n'est pas versionnée."""
    m = PREFIXE.match(chemin)
    if not m:
        return None
    return f"/static/{m.group(2)}", m.group(1) == version()


def reponse(chemin: str, courant: bool, portee: str) -> Response | None:
    """Le script, la feuille ou la page qui porte des adresses absolues, réécrites sous l'empreinte ; None pour tout autre
    fichier (le service des fichiers statiques s'en charge). portee : « public » (de la table) ou « private » (le reste
    de l'atelier, derrière un mot de passe : jamais gardé par un intermédiaire)."""
    source = (STATIQUE / chemin[len("/static/"):])
    if source.suffix not in TYPES_REECRITS:
        return None
    try:
        source = source.resolve(strict=True)
        source.relative_to(STATIQUE.resolve())
        st = source.stat()
    except (OSError, ValueError):
        return None
    v = version()
    cle = (str(source), st.st_mtime_ns, st.st_size, v)
    if cle not in _reecrits:
        try:
            brut = source.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return None
        texte = nom_campagne.nommer(brut) if source.suffix == ".html" else brut
        if texte == brut and "/static/" not in texte and "../fonts/" not in texte:
            _reecrits[cle] = None
        else:
            _reecrits[cle] = (LIENS_HTML.sub(rf"\1/static/v-{v}/", reecrire_texte(texte, v)) if source.suffix == ".html"
                              else reecrire_texte(texte, v)).encode()
        if len(_reecrits) > 400:
            _reecrits.pop(next(iter(_reecrits)))
    corps = _reecrits[cle]
    if corps is None:
        return None
    genre = mimetypes.guess_type(source.name)[0] or "application/octet-stream"
    if genre.startswith("text/") or genre.endswith("javascript"):
        genre += "; charset=utf-8"
    return Response(corps, media_type=genre, headers={
        "Cache-Control": IMMUABLE.format(portee=portee) if courant else "no-cache",
        "ETag": f'"{hashlib.sha1(corps).hexdigest()[:16]}"'})


def cache_control(courant: bool, portee: str) -> str:
    return IMMUABLE.format(portee=portee) if courant else "no-cache"


IMPORT_STATIQUE = re.compile(r"""(?:^|[;\n}])\s*(?:import|export)\b[^'"`;()]*?\bfrom\s*["']([^"']+)["']|(?:^|[;\n}])\s*import\s*["']([^"']+)["']""")
SCRIPT_MODULE = re.compile(r'<script type="module" src="/static/(?:v-[0-9a-f]{10}/)?([^"]+)"></script>')
_graphes: dict = {}


def dependances(entree: str) -> list[str]:
    """Les modules que charge `entree` (chemin sous static/, « js/atelier.js »), elle comprise, par les imports statiques :
    le navigateur les découvre un niveau à la fois (13 allers-retours pour l'atelier) ; annoncés d'un coup en tête de page
    (modulepreload), ils arrivent ensemble. Les imports dynamiques (import()) ne comptent pas : ils restent à la demande."""
    cle = (entree, version())
    if cle in _graphes:
        return _graphes[cle]
    vus: list[str] = []
    pile = [entree]
    while pile:
        courant = pile.pop(0)
        if courant in vus:
            continue
        vus.append(courant)
        try:
            source = (STATIQUE / courant).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for m in IMPORT_STATIQUE.finditer(source):
            cible = m.group(1) or m.group(2)
            if cible.startswith("."):
                pile.append(posixpath.normpath(posixpath.join(posixpath.dirname(courant), cible)))
    for ancien in [c for c in _graphes if c[1] != cle[1]]:
        _graphes.pop(ancien)
    _graphes[cle] = vus
    return vus


def precharger(page: str) -> str:
    """Ajoute à une page HTML les « modulepreload » de tout le graphe de ses modules (adresses versionnées)."""
    m = SCRIPT_MODULE.search(page)
    if not m or "</head>" not in page:
        return page
    v = version()
    liens = "".join(f'  <link rel="modulepreload" href="/static/v-{v}/{c}">\n' for c in dependances(m.group(1)))
    return page.replace("</head>", liens + "</head>", 1)


def page_html(nom: str, marques: str = "") -> Response:
    """Une page HTML de static/, ses liens sous l'empreinte des fichiers (statiques_versionnes.py). La page elle-même se
    redemande toujours (no-cache) : elle porte l'empreinte du moment."""
    page = (STATIQUE / nom).read_text(encoding="utf-8")
    if marques:
        page = page.replace('<body class="atelier">', f'<body class="atelier"{marques}>', 1)
    return Response(precharger(reecrire_html(page)), media_type="text/html; charset=utf-8", headers={"Cache-Control": "no-cache"})
