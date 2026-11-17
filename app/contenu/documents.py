"""Les documents remis aux joueurs : une lettre trouvée sur un cadavre, une affiche arrachée, une note griffonnée, un
parchemin officiel, un plan. Le MJ les écrit dans l'atelier (js/documents/), les montre à la TV, les imprime sur
parchemin pour les tendre en main propre ; une fois montrés à la TV, ils entrent dans le carnet de la compagnie
(« Documents reçus »), sauf si le MJ décoche « Garder dans le carnet ».

Ce qui sort d'ici est la partie publique d'un document (public) : son titre, son genre, son texte, sa signature, son
image et son sceau, passés au masque (le nom caché de l'auberge). Jamais les notes du MJ. La TV et la table publique ne
lisent un document que tant que la TV le montre : un document jamais montré ne sort pas, et un jeton gardé ne relit rien
le lendemain. La fiche elle-même (lecture, écriture, corbeille, versions) passe par routes_fiches de main.py ; le champ
« montre » (la première fois que la TV l'a montré) ne s'écrit qu'ici, quand l'état de la table le désigne."""

import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from mj import cloisonnement

GENRES = ("lettre", "affiche", "note", "parchemin", "plan")
ID = re.compile(r"^[a-z0-9-]{1,60}$")
# Ce qu'un document peut porter : assez pour une longue lettre, pas de quoi noyer la TV ni le carnet.
TITRE_MAX = 160
TEXTE_MAX = 6000
SIGNATURE_MAX = 160
COLLECTION = "documents"
# Tenus par le serveur : un enregistrement de la fiche entière (un écran ouvert avant que la TV ne le montre) les reprend
# du disque, une version précédente remise aussi.
PROTEGES = {"montre": None}


def court(valeur, limite: int) -> str:
    t = valeur if isinstance(valeur, str) else ""
    return t.strip()[:limite]


def genre_de(d: dict) -> str:
    return d.get("genre") if d.get("genre") in GENRES else "lettre"


def sceau_de(d: dict) -> bool:
    """Le sceau de cire : celui que le MJ a choisi ; sans choix, seul le parchemin officiel en porte un."""
    return d["sceau"] if isinstance(d.get("sceau"), bool) else genre_de(d) == "parchemin"


def dans_le_carnet(d: dict) -> bool:
    """« Garder dans le carnet », coché par défaut : un document montré à la TV y entre, sauf si le MJ l'a décoché."""
    return d.get("dans_le_carnet") is not False


def montre_une_fois(d: dict) -> bool:
    return isinstance(d.get("montre"), str) and bool(d["montre"])


class Documents:
    """Les routes et les projections des documents. Les fonctions de main.py arrivent par le constructeur : jeton
    (collection, ident), media_existant(url), masquer_tout(contenu), secrets(texte) (les PNJ, lieux et peuples encore
    inconnus des joueurs que nomme un texte), etat_table() (l'état enregistré de la table, vrais identifiants)."""

    def __init__(self, dossier: Path, statique: Path, *, lire_fiche, lire_tout, existant, ecrire, maintenant, jeton, par_jeton,
                 media_existant, masquer_tout, secrets, etat_table):
        self.dossier = dossier
        self.statique = statique
        self.lire_fiche = lire_fiche
        self.lire_tout = lire_tout
        self.existant = existant
        self.ecrire = ecrire
        self.maintenant = maintenant
        self.jeton = jeton
        self.par_jeton = par_jeton
        self.media_existant = media_existant
        self.masquer_tout = masquer_tout
        self.secrets = secrets
        self.etat_table = etat_table
        self.router = self.routes()

    def public(self, d: dict) -> dict:
        """Ce que voient les joueurs, avant le masque : liste blanche, sans les notes du MJ ni rien d'autre de la fiche."""
        image = d.get("image")
        return {
            "id": self.jeton(COLLECTION, d["id"]),
            "genre": genre_de(d),
            "nom": court(d.get("nom"), TITRE_MAX),
            "texte": court(d.get("texte"), TEXTE_MAX),
            "signature": court(d.get("signature"), SIGNATURE_MAX),
            "image": image if self.media_existant(image) else None,
            "sceau": sceau_de(d),
        }

    def a_l_ecran(self, ident: str) -> bool:
        etat = self.etat_table()
        return isinstance(etat, dict) and etat.get("vue") == "document" and etat.get("document") == ident

    def inconnus(self, d: dict) -> list:
        """Les noms inconnus des joueurs que nomme le document, tel que la TV le montrerait (passé au masque). Ceux de
        l'autre MJ, anonymisés (cloisonnement.secret_vu)."""
        vu = self.masquer_tout(self.public(d))
        return cloisonnement.secrets_vus(self.secrets("\n".join(vu[k] for k in ("nom", "texte", "signature") if vu[k])))

    def noter_montre(self, etat: dict) -> None:
        """La TV va montrer ce document : la première fois est notée (il entre alors dans le carnet). Ni la version de la
        fiche ni sa date de modification ne bougent : l'écran qui l'a ouverte continue d'enregistrer sans conflit."""
        ident = etat.get("document") if isinstance(etat, dict) and etat.get("vue") == "document" else None
        if not isinstance(ident, str) or not ID.match(ident):
            return
        chemin = self.dossier / f"{ident}.json"
        if not chemin.is_file():
            return
        try:
            d = self.lire_fiche(chemin)
        except HTTPException:
            return
        if not montre_une_fois(d):
            d["montre"] = self.maintenant()
            self.ecrire(chemin, d)

    def au_carnet(self) -> list:
        """Les documents que reçoit le carnet : montrés au moins une fois à la TV et gardés, le plus récent d'abord."""
        liste = [d for d in self.lire_tout(self.dossier, tout=True) if isinstance(d.get("id"), str) and montre_une_fois(d) and dans_le_carnet(d)]
        return sorted(liste, key=lambda d: d["montre"], reverse=True)

    def routes(self) -> APIRouter:
        r = APIRouter()

        @r.get("/api/table/document/{j}")
        def table_document(j: str):
            """Pour la TV et la table publique : seulement le document qu'elle montre, tant qu'elle le montre."""
            chemin = self.par_jeton(self.dossier, COLLECTION, j)
            if not self.a_l_ecran(chemin.stem):
                raise HTTPException(404, "Introuvable")
            return self.masquer_tout(self.public(self.lire_fiche(chemin)))

        @r.get("/api/documents/{ident}/inconnus")
        def inconnus_du_document(ident: str):
            """Pour l'atelier, avant de montrer : ce qu'il nomme d'encore inconnu des joueurs (un avertissement)."""
            return {"secrets": self.inconnus(self.lire_fiche(self.existant(self.dossier, ident)))}

        @r.get("/api/documents/{ident}/imprime")
        def document_imprime(ident: str):
            """Pour la page imprimée : le document tel que le tiendront les joueurs (masqué), et ce qu'il nomme
            d'inconnu, rappelé au MJ à l'écran seulement."""
            d = self.lire_fiche(self.existant(self.dossier, ident))
            return {"document": self.masquer_tout(self.public(d)) | {"id": d["id"]}, "secrets": self.inconnus(d)}

        @r.get("/document-imprime")
        def page_document_imprime():
            return FileResponse(self.statique / "document-imprime.html", headers={"Cache-Control": "no-cache"})

        @r.get("/documents-imprimes")
        def page_documents_imprimes():
            return FileResponse(self.statique / "document-imprime.html", headers={"Cache-Control": "no-cache"})

        return r
