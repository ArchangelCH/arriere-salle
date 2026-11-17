"""Ce que l'atelier et le coin des joueurs partagent pour garder une porte : l'empreinte d'un mot de passe (scrypt, au
format de outils/mot-de-passe.py), un jeton signé qui porte son échéance (les cookies de session), la lecture d'un
cookie et le compte des essais manqués.

Fonctions pures : ce module ne lit ni les fichiers de l'atelier ni ceux du coin. main.py et joueurs.py l'importent
tous les deux, avec les mêmes bornes des deux côtés.
"""
import asyncio
import hashlib
import hmac
import secrets
import time
import weakref

# Les réglages de outils/mot-de-passe.py : environ 32 Mo et un dixième de seconde par calcul.
N, R, P = 2 ** 15, 8, 1
MEMOIRE = 128 * 1024 * 1024
# Deux calculs à la fois au plus : une rafale d'essais attend son tour au lieu de remplir la mémoire du conteneur.
CALCULS_EN_MEME_TEMPS = 2
_CALCULS: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore]" = weakref.WeakKeyDictionary()


def empreinte(mot_de_passe: str) -> str:
    """« scrypt:n:r:p:sel:empreinte » en hexadécimal, comme l'écrit outils/mot-de-passe.py."""
    sel = secrets.token_bytes(16)
    h = hashlib.scrypt(mot_de_passe.encode(), salt=sel, n=N, r=R, p=P, maxmem=MEMOIRE, dklen=32)
    return f"scrypt:{N}:{R}:{P}:{sel.hex()}:{h.hex()}"


def verifier(attendue: str, mot_de_passe: str) -> bool:
    """Vrai si le mot de passe donne cette empreinte. Une empreinte vide ou mal formée ne laisse entrer personne."""
    try:
        algo, n, r, p, sel, attendu = attendue.split(":")
        if algo != "scrypt" or not mot_de_passe or not attendu.isascii():
            return False
        calcule = hashlib.scrypt(mot_de_passe.encode(), salt=bytes.fromhex(sel), n=int(n), r=int(r), p=int(p),
                                 maxmem=MEMOIRE, dklen=len(attendu) // 2)
    except ValueError:
        return False
    return hmac.compare_digest(calcule.hex(), attendu.lower())


async def calculer(fonction, *arguments):
    """Un calcul scrypt hors de la boucle d'événements (un fil à part), deux au plus à la fois. Un sémaphore par boucle :
    les essais en lancent une par client."""
    boucle = asyncio.get_running_loop()
    tour = _CALCULS.get(boucle)
    if tour is None:
        tour = _CALCULS[boucle] = asyncio.Semaphore(CALCULS_EN_MEME_TEMPS)
    async with tour:
        return await asyncio.to_thread(fonction, *arguments)


def signer(cle: bytes, message: str) -> str:
    return hmac.new(cle, message.encode(), hashlib.sha256).hexdigest()


def jeton_signe(champs: list, echeance: int, signature) -> str:
    """« champ.….échéance.signature » ; signature(champs, echeance) rend la signature (signer, sur ce que le jeton doit
    lier : une empreinte de mot de passe, celle d'un lien)."""
    champs = [str(c) for c in champs]
    return ".".join([*champs, str(echeance), signature(champs, echeance)])


def jeton_valide(valeur: str, signature, champs: int = 0) -> list | None:
    """Les champs d'un jeton signé encore valable, sinon None : forme inattendue, échéance passée ou signature fausse."""
    morceaux = (valeur or "").split(".")
    if len(morceaux) != champs + 2:
        return None
    *avant, echeance, recue = morceaux
    if not echeance.isdigit() or int(echeance) < time.time() or not recue.isascii():
        return None
    attendue = signature(avant, int(echeance))
    return avant if attendue and hmac.compare_digest(recue, attendue) else None


def lire_cookie(entete: str, nom: str) -> str:
    for morceau in (entete or "").split(";"):
        cle, _, valeur = morceau.strip().partition("=")
        if cle == nom:
            return valeur
    return ""


class Essais:
    """Les essais manqués de la dernière heure, chacun noté une fois avec ses clés (une adresse, un identifiant). Un
    essai est permis tant qu'aucune de ses clés n'a atteint sa limite. Au-delà du plafond (tous essais confondus : une
    attaque venue de nombreuses adresses), la porte ne se ferme pas à tout le monde : seules passent encore les adresses
    qui n'ont presque rien manqué (SOUS_PLAFOND), pour que celui qui a le bon mot de passe entre quand même."""

    HORIZON = 3600  # secondes : la plus longue des fenêtres
    SOUS_PLAFOND = 2  # essais manqués permis à une adresse, par heure, une fois le plafond atteint
    MEMOIRE = 5000  # essais gardés au plus : au-delà, plus rien ne passe (la mémoire reste bornée)

    def __init__(self):
        self.echecs: list[tuple[float, frozenset]] = []

    def clear(self) -> None:
        self.echecs.clear()

    def permis(self, limites: dict, plafond: int) -> bool:
        """limites : {clé: (nombre d'échecs, fenêtre en secondes)}."""
        instant = time.monotonic()
        self.echecs[:] = [(t, c) for t, c in self.echecs if instant - t < self.HORIZON]
        for cle, (nombre, fenetre) in limites.items():
            if sum(1 for t, c in self.echecs if cle in c and instant - t < fenetre) >= nombre:
                return False
        if len(self.echecs) < plafond:
            return True
        if len(self.echecs) >= self.MEMOIRE:
            return False
        adresses = [cle for cle in limites if isinstance(cle, tuple) and cle and cle[0] == "adresse"]
        return bool(adresses) and all(sum(1 for _, c in self.echecs if cle in c) < self.SOUS_PLAFOND for cle in adresses)

    def noter(self, *cles):
        entree = (time.monotonic(), frozenset(cles))
        self.echecs.append(entree)
        return entree

    def reserver(self, cles: tuple, limites: dict, plafond: int):
        """Permis, l'essai compte aussitôt comme manqué (rendu par liberer s'il réussit) : une rafale lancée d'un coup ne
        passe pas tout entière avant que le premier calcul ait fini. None s'il n'est pas permis."""
        return self.noter(*cles) if self.permis(limites, plafond) else None

    def liberer(self, entree) -> None:
        try:
            self.echecs.remove(entree)
        except ValueError:
            pass

    def oublier(self, *cles) -> None:
        """Après un succès : les échecs notés avec toutes ces clés s'effacent (ses propres fautes de frappe)."""
        voulues = set(cles)
        self.echecs[:] = [(t, c) for t, c in self.echecs if not voulues <= c]
