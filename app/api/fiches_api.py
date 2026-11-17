"""Les collections de fiches (lieux, PNJ, contrats, rumeurs, séances, plans...) et leurs routes communes."""

import json
from contextlib import nullcontext
from pathlib import Path

from fastapi import HTTPException, Request

from mj import cloisonnement
from commun import confie
from contenu import documents
from coin_mj import mouvements
from mj import proprietes

from api.application import app
from api import config, application, listes_json, utilitaires, tv_ecran


# Tenus par le serveur : un PATCH ne les change jamais (l'auteur d'une fiche, proprietes.py, compris).
RESERVES = ("id", "cree", "modifie", "illustrations", "illustration", "auteur")


def coin_suit(prefixe: str, ident: str) -> None:
    """Un plan ou une carte que montre la TV, enregistré : la table du coin se republie aussitôt (regroupée), sans attendre
    que l'éditeur renvoie la table ni le secours des 30 secondes (table_joueurs.Publication)."""
    vue = {"plans": "plan", "cartes": "carte"}.get(prefixe)
    etat = tv_ecran.etat_table() if vue else {}
    if vue and etat.get("vue") == vue and etat.get(vue) == ident:
        tv_etat.table_coin.signaler()


class RejeuDesPlans:
    """Le rejeu des déplacements des joueurs pour le PUT des plans (mouvements.py) : l'instance naît plus bas, avec la
    table du coin ; ceci la trouve au moment de la requête."""

    @property
    def verrou(self):
        return tv_etat.mouvements_joueurs.verrou

    def rejouer(self, fiche: dict, base, precedente: dict):
        return tv_etat.mouvements_joueurs.rejouer(fiche, base, precedente)


def illustrations_valides(fiche: dict) -> None:
    """À la création, seules des images déjà présentes dans /media peuvent être rattachées à une fiche."""
    liste = [i for i in fiche.get("illustrations") or [] if isinstance(i, dict) and utilitaires.media_existant(i.get("url"))]
    fiche["illustrations"] = liste
    if fiche.get("illustration") not in [i["url"] for i in liste]:
        fiche["illustration"] = liste[0]["url"] if liste else None


def routes_fiches(prefixe: str, dossier: Path, cible: str, nom_defaut: str, proteges: dict | None = None,
                  archives: int = config.ARCHIVES_MAX, rejeu=None, projection=None, resume_champs: tuple | None = None) -> None:
    """Lecture, écriture, corbeille et illustrations d'une collection de fiches (lieux, PNJ, contrats…).
    Les champs `proteges` (avec leur valeur de départ) ne s'écrivent que par leurs routes dédiées : un enregistrement
    de la fiche entière les reprend du disque. `rejeu` (les plans, mouvements.py) : ce qui a changé depuis la version de
    la page, s'il ne s'agit que de déplacements de joueurs, se rejoue sur ce qu'elle envoie au lieu d'un conflit."""
    proteges = proteges or {}
    # Les collections que chaque MJ tient pour lui (proprietes.py) : l'auteur vient du serveur, jamais de la page.
    a_auteur = proprietes.a_auteur(prefixe)

    def vue(fiche: dict) -> dict:
        """projection : ce qu'un MJ invité lit d'une fiche commune (la tablée, sans les secrets des héros)."""
        if projection and cloisonnement.est_invite() and cloisonnement.refuse("fiche-commune-entiere", prefixe):
            return projection(fiche)
        return fiche

    def verrou():
        """Une écriture à la fois entre la lecture d'une fiche et son écriture. Les plans : celui du rejeu. Les fiches
        illustrées (lieux, PNJ, aventuriers) : SAC_VERROU, que prennent aussi les fils qui les écrivent (la boîte du MJ
        pour un sac, un don, un portrait choisi ou accepté par un joueur ; la file des portraits peints). Sans lui, un
        « Choisir » de la galerie effaçait le portrait qu'un joueur venait de faire accepter."""
        if rejeu:
            return rejeu.verrou
        return heros_etat.SAC_VERROU if cible in application.DOSSIERS else nullcontext()

    @app.get(f"/api/{prefixe}", name=f"liste_{prefixe}")
    def liste(requete: Request, resume: int = 0):
        # En JSON déjà écrit, gardé tant que le dossier ne change pas (listes_json.py) ; ?resume=1 : seulement les champs
        # d'un menu, quand la collection en déclare (les plans : sans leurs grilles).
        champs = resume_champs if resume and resume_champs else None
        genre = "projection" if projection and cloisonnement.est_invite() else "entiere"
        return listes_json.reponse(requete, dossier, genre,
                                   lambda: [vue(f) for f in utilitaires.lire_tout(dossier, lecture=True)] if projection else utilitaires.lire_tout(dossier, lecture=True), champs)

    @app.post(f"/api/{prefixe}", name=f"creer_{prefixe}")
    async def creer(requete: Request):
        fiche = await utilitaires.corps_objet(requete)
        fiche.pop("version_base", None)
        fiche["id"] = utilitaires.nouvel_id(dossier, utilitaires.texte(fiche.get("nom")) or nom_defaut)
        fiche["cree"] = fiche["modifie"] = utilitaires.maintenant()
        if a_auteur:
            proprietes.poser_auteur(fiche)
        proprietes.partage_propre(prefixe, fiche)
        for cle, depart in proteges.items():
            fiche[cle] = json.loads(json.dumps(depart))
        illustrations_valides(fiche)
        utilitaires.ecrire(dossier / f"{fiche['id']}.json", fiche)
        return fiche

    @app.get(f"/api/{prefixe}/{{ident}}", name=f"lire_{prefixe}")
    def lire_une(ident: str):
        return vue(utilitaires.lire_fiche(utilitaires.existant(dossier, ident, lecture=True)))

    @app.put(f"/api/{prefixe}/{{ident}}", name=f"enregistrer_{prefixe}")
    async def enregistrer(ident: str, requete: Request):
        chemin = utilitaires.existant(dossier, ident)
        fiche = await utilitaires.corps_objet(requete)
        rejoues = None
        # Sous le verrou du rejeu : un déplacement accepté depuis la boîte ne passe pas entre la lecture et l'écriture.
        with verrou():
            precedente = utilitaires.lire_fiche(chemin)
            # Une page qui envoie sa version ne doit pas écraser ce qu'un autre écran a enregistré entre-temps.
            if "version_base" in fiche:
                base = fiche.pop("version_base")
                if base != precedente.get("modifie"):
                    rejoues = rejeu.rejouer(fiche, base, precedente) if rejeu else None
                    if rejoues is None:
                        raise HTTPException(409, "Cette fiche a été modifiée depuis un autre écran.")
            fiche["id"] = ident
            fiche["cree"] = precedente.get("cree")
            # Les illustrations ne passent que par leurs routes dédiées : une fiche ouverte depuis longtemps ne les efface pas.
            fiche["illustrations"] = precedente.get("illustrations", [])
            fiche["illustration"] = precedente.get("illustration")
            for cle, depart in proteges.items():
                fiche[cle] = precedente.get(cle, depart)
            if a_auteur:
                proprietes.garder_auteur(fiche, precedente)
            proprietes.partage_propre(prefixe, fiche)
            fiche["modifie"] = mouvements.plus_tard(precedente.get("modifie"), utilitaires.maintenant()) if rejeu else utilitaires.maintenant()
            utilitaires.archiver(chemin, prefixe, archives)
            utilitaires.ecrire(chemin, fiche)
        coin_suit(prefixe, ident)
        # Les déplacements rejoués : l'éditeur les pose aussi chez lui (js/plan/mouvements-joueurs.js).
        return {**fiche, "rejoues": rejoues} if rejoues else fiche

    @app.patch(f"/api/{prefixe}/{{ident}}", name=f"modifier_{prefixe}")
    async def modifier(ident: str, requete: Request):
        """Change quelques champs (connu, état…) sans renvoyer toute la fiche : rien d'autre n'est écrasé."""
        chemin = utilitaires.existant(dossier, ident)
        champs = await utilitaires.corps_objet(requete)
        # Sous le verrou du rejeu, comme le PUT : un déplacement accepté depuis la boîte (un autre fil) ne passe pas entre
        # la lecture et l'écriture (« Poser les adversaires » écrit les pions par ici).
        with verrou():
            precedente = utilitaires.lire_fiche(chemin)
            if "version_base" in champs and champs.pop("version_base") != precedente.get("modifie"):
                raise HTTPException(409, "Cette fiche a été modifiée depuis un autre écran.")
            for cle in (*RESERVES, *proteges):
                champs.pop(cle, None)
            fiche = {**precedente, **champs,
                     "modifie": mouvements.plus_tard(precedente.get("modifie"), utilitaires.maintenant()) if rejeu else utilitaires.maintenant()}
            proprietes.partage_propre(prefixe, fiche)
            utilitaires.archiver(chemin, prefixe, archives)
            utilitaires.ecrire(chemin, fiche)
        coin_suit(prefixe, ident)
        return fiche

    @app.delete(f"/api/{prefixe}/{{ident}}", name=f"supprimer_{prefixe}")
    def supprimer(ident: str):
        # Un plan jeté pendant qu'un déplacement s'écrit ne renaît pas de lui (même verrou que le PUT) ; un héros jeté
        # pendant qu'un geste de son joueur s'écrit non plus.
        with verrou():
            utilitaires.jeter(utilitaires.existant(dossier, ident), prefixe)
        return {"ok": True}

    if cible not in application.DOSSIERS:
        return

    @app.post(f"/api/{prefixe}/{{ident}}/illustrations", name=f"importer_illustration_{prefixe}")
    async def importer_illustration(ident: str, requete: Request):
        corps = await utilitaires.corps_objet(requete)
        url = corps.get("url", "")
        if not utilitaires.media_existant(url):
            raise HTTPException(400, "Illustration inconnue")
        return application.ajouter_illustration(cible, ident, {"url": url, "source": utilitaires.texte(corps.get("source")) or "import", "prompt": utilitaires.texte(corps.get("prompt"))})

    @app.delete(f"/api/{prefixe}/{{ident}}/illustrations", name=f"retirer_illustration_{prefixe}")
    async def retirer_illustration(ident: str, url: str):
        with verrou():
            chemin = utilitaires.existant(dossier, ident)
            fiche = utilitaires.lire_fiche(chemin)
            fiche["illustrations"] = [i for i in fiche.get("illustrations", []) if i.get("url") != url]
            if fiche.get("illustration") == url:
                fiche["illustration"] = fiche["illustrations"][0]["url"] if fiche["illustrations"] else None
            utilitaires.ecrire(chemin, fiche)
        return fiche

    @app.put(f"/api/{prefixe}/{{ident}}/illustration", name=f"choisir_illustration_{prefixe}")
    async def choisir_illustration(ident: str, requete: Request):
        # Le corps d'abord : rien n'est attendu entre la lecture de la fiche et son écriture.
        url = (await utilitaires.corps_objet(requete)).get("url")
        with verrou():
            chemin = utilitaires.existant(dossier, ident)
            fiche = utilitaires.lire_fiche(chemin)
            if url not in [i.get("url") for i in fiche.get("illustrations", [])]:
                raise HTTPException(400, "Cette illustration n'est pas dans la fiche")
            fiche["illustration"] = url
            utilitaires.ecrire(chemin, fiche)
        return fiche


routes_fiches("lieux", config.LIEUX, "lieu", "lieu")
routes_fiches("pnj", config.PNJ, "pnj", "pnj")
routes_fiches("contrats", config.CONTRATS, "contrat", "contrat")
routes_fiches("rumeurs", config.RUMEURS, "rumeur", "rumeur")
routes_fiches("fils", config.FILS, "fil", "fil")
# Le journal de séance ne s'écrit que par ses routes (plus bas) : deux écrans qui notent en même temps ne se perdent
# rien, et l'enregistrement de la fiche entière depuis un onglet resté ouvert ne l'efface pas.
routes_fiches("seances", config.SEANCES, "seance", "seance", proteges={"journal": [], "combat": None})
routes_fiches("rencontres", config.RENCONTRES, "rencontre", "rencontre")
# Ce qu'un joueur confie au MJ seul (confie_mj.py) ne s'écrit que par sa route : ni un enregistrement de la fiche, ni une
# création ne le touchent.
routes_fiches("aventuriers", config.AVENTURIERS, "aventurier", "aventurier", proteges={confie.CHAMP: None},
              projection=lambda a: tv_fiches.heros_pour_l_invite(a))
# Les plans : un éditeur en retard de seuls déplacements de joueurs les rejoue au lieu d'un conflit (mouvements.py).
routes_fiches("plans", config.PLANS, "plan", "plan", rejeu=RejeuDesPlans(),
              resume_champs=("id", "nom", "lieu", "etage", "style", "modifie", "cree", "auteur", "largeur", "hauteur", "m_case", "nb_etapes", "etape",
                             "illustration"))
# Les idées de campagne du MJ : jamais envoyées à la TV.
# Les squelettes proposés pour une idée (squelettes_api.py) ne s'écrivent que par leurs routes.
routes_fiches("idees", config.IDEES, "idee", "idee", proteges={"squelettes": []})
# Les boutiques : la TV n'en reçoit que la partie publique (/api/table/boutique/…), jamais les notes du MJ.
routes_fiches("boutiques", config.BOUTIQUES, "boutique", "boutique")
# Les documents remis aux joueurs : la TV n'en lit que la partie publique, tant qu'elle les montre (documents.py).
routes_fiches("documents", config.DOCUMENTS, "document", "document", proteges=documents.PROTEGES)


# Modules qui se servent les uns des autres seulement à l'appel d'une route : importés ici, une fois les définitions
# posées, pour ne pas former de cycle au chargement.
from api import heros_etat, tv_fiches, tv_etat  # noqa: E402
