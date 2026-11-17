"""Le PDF d'une page de l'atelier, rendu par Chromium sans écran : le rendu de l'impression sur ordinateur (A4, sans
marges, parchemin compris), quel que soit l'appareil qui le demande. Un téléphone ou un iPad imprime mal ces pages ;
un PDF, lui, s'imprime et se partage partout.

Chromium ne sort pas de la machine (SANS_RESEAU) : il n'ouvre que la page du service qui l'a lancé, par la boucle
locale. Une adresse glissée dans une fiche (image, feuille de style, police, cadre, redirection) ne mène nulle part : ni
vers Internet, ni vers un autre conteneur du réseau Docker (l'atelier, qui croit parler au réseau local)."""
import asyncio
import os
import shutil
import tempfile
from pathlib import Path

CHROMIUM = shutil.which("chromium") or shutil.which("chromium-browser") or shutil.which("google-chrome")
DELAI = 45
# Un rendu à la fois : Chromium est gourmand, et une page ne doit pas pouvoir en lancer dix.
UN_A_LA_FOIS = asyncio.Semaphore(1)
# Tout ce qui n'est pas la boucle locale passe par un mandataire qui n'existe pas (le port 9 n'écoute pas), et aucun nom
# ne se résout hors de localhost et de 127.0.0.1 : une adresse IP comme un nom de conteneur échouent. Ni requêtes de fond, ni
# préchargement de noms, ni pings.
SANS_RESEAU = ("--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=<-loopback>;localhost;127.0.0.1",
               "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1", "--disable-background-networking",
               "--dns-prefetch-disable", "--no-pings", "--disable-component-update", "--disable-sync",
               "--disable-domain-reliability", "--disable-default-apps", "--disable-client-side-phishing-detection")


class RenduImpossible(Exception):
    pass


async def page_en_pdf(url: str) -> bytes:
    if not CHROMIUM:
        raise RenduImpossible("Chromium n'est pas installé dans ce conteneur")
    async with UN_A_LA_FOIS:
        with tempfile.TemporaryDirectory(prefix="pdf-") as dossier:
            sortie = Path(dossier) / "page.pdf"
            proc = await asyncio.create_subprocess_exec(
                CHROMIUM, "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run",
                "--no-default-browser-check", "--disable-extensions", "--hide-scrollbars", f"--user-data-dir={dossier}/profil",
                *SANS_RESEAU,
                # Le temps virtuel laisse la page charger sa fiche, ses polices et ses images, puis se resserrer.
                "--no-pdf-header-footer", "--virtual-time-budget=15000", "--run-all-compositor-stages-before-draw",
                f"--print-to-pdf={sortie}", url,
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
                env={**os.environ, "HOME": dossier},
            )
            try:
                await asyncio.wait_for(proc.wait(), DELAI)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
                raise RenduImpossible("Le rendu a pris trop de temps")
            if not sortie.exists() or sortie.stat().st_size < 2000:
                raise RenduImpossible("Le rendu n'a rien produit")
            return sortie.read_bytes()


def nom_de_fichier(nom: str) -> str:
    """En-tête Content-Disposition : le nom accentué (RFC 5987), et une version ASCII pour les vieux navigateurs."""
    from urllib.parse import quote
    import unicodedata
    propre = " ".join((nom or "Aventurier").replace("/", " ").split())[:80]
    # Un nom choisi par le joueur : ni guillemet ni barre oblique inverse dans la version entre guillemets.
    ascii_ = unicodedata.normalize("NFKD", propre).encode("ascii", "ignore").decode().replace('"', "'").replace("\\", " ") or "fiche"
    return f'attachment; filename="{ascii_} - fiche.pdf"; filename*=UTF-8\'\'{quote(propre + " - fiche.pdf")}'
