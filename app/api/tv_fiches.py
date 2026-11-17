"""Ce que la TV reçoit des PNJ, rumeurs, billets, épisodes et héros."""

import re
from pathlib import Path

from fastapi import HTTPException

from mj import adresses
from mj import cloisonnement
from table import couleurs_tv
from contenu import documents
from table.masque import masquer, masquer_tout, secrets_dans
from coin_mj.prives_mj import PrivesMJ

from api.application import app
from api import config, utilitaires, joueurs_mj, carnet_api, tv_cartes


def pnj_public(pnj: dict) -> dict:
    return {
        "id": tv_cartes.jeton("pnj", pnj["id"]),
        "nom": pnj.get("nom", ""),
        "surnom": pnj.get("surnom", ""),
        "role": pnj.get("role", ""),
        "peuple": pnj.get("peuple", ""),
        "apparence": pnj.get("apparence", ""),
        "illustration": tv_cartes.url_publique(pnj),
    }


@app.get("/api/table/pnj/{j}")
def table_pnj(j: str):
    pnj = utilitaires.lire_fiche(tv_cartes.par_jeton(config.PNJ, "pnj", j))
    if not pnj.get("connu"):
        raise HTTPException(404, "Introuvable")
    return tv_cartes.reponse_publique(pnj_public(pnj))


@app.get("/api/pnj/{ident}/carton")
def carton_pnj_verifie(ident: str):
    """Pour l'atelier, avant d'envoyer le carton d'un PNJ à la TV : les PNJ, lieux ou peuples encore inconnus des joueurs
    qu'il nomme, tel que la TV le montrerait (nom, surnom, rôle, peuple, apparence ; passé au masque). Le PNJ lui-même
    n'y compte pas : montrer son carton le rend connu. Un avertissement : rien n'est bloqué."""
    pnj = utilitaires.lire_fiche(utilitaires.existant(config.PNJ, ident, lecture=True))
    carton = masquer_tout(pnj_public(pnj))
    textes = "\n".join(v for k, v in carton.items() if k not in ("id", "illustration") and isinstance(v, str))
    vus = {"secrets": cloisonnement.secrets_vus(secrets_dans(textes, noms_caches.secrets_des_joueurs(frozenset({pnj.get("id")}))))}
    # Partagé par l'autre MJ : celui qui lit ne peut pas le rendre connu des joueurs (carton-pnj.js le dit avant d'essayer).
    if cloisonnement.partagee_par_un_autre("pnj", config.PNJ / f"{ident}.json"):
        vus["lecture_seule"] = True
    return vus


CONTRATS_VISIBLES = ("affiche", "pris")


def contrat_public(c: dict) -> dict:
    return ({k: utilitaires.texte(c.get(k)) for k in ("genre", "nom", "affiche", "recompense", "contact", "mention", "etat")}
            | {"id": tv_cartes.jeton("contrats", c["id"]), "delave": bool(c.get("delave"))})


@app.get("/api/table/planche")
def table_planche():
    visibles = [c for c in utilitaires.lire_tout(config.CONTRATS, tout=True) if c.get("etat") in CONTRATS_VISIBLES and c.get("id")]
    visibles.sort(key=lambda c: (utilitaires.nombre(c.get("ordre")), utilitaires.texte(c.get("cree"))))
    return tv_cartes.reponse_publique([contrat_public(c) for c in visibles])


@app.get("/api/table/rumeur/{j}")
def table_rumeur(j: str):
    chemin = tv_cartes.par_jeton(config.RUMEURS, "rumeurs", j)
    rumeur = utilitaires.lire_fiche(chemin)
    # Une rumeur « à placer » n'est pas encore entendue : on ne la lit pas, sauf si le MJ la montre à la TV à l'instant (il a
    # envoyé la rumeur avant que la fiche ne soit enregistrée « entendue » : sans cela, un 404 et un carton qui n'apparaît pas).
    if rumeur.get("etat") in (None, "", "a-placer") and tv_ecran.etat_table().get("rumeur") != chemin.stem:
        raise HTTPException(404, "Introuvable")
    return tv_cartes.reponse_publique({"id": j, "texte": utilitaires.texte(rumeur.get("texte")), "source": utilitaires.texte(rumeur.get("source"))})


# Les documents remis aux joueurs (documents.py) : la TV et la table publique ne lisent que celui qu'elle montre ; l'atelier
# vérifie ce qu'il nomme d'inconnu avant de le montrer, et l'imprime sur parchemin.
remis = documents.Documents(
    config.DOCUMENTS, config.ICI / "static", lire_fiche=utilitaires.lire_fiche, lire_tout=utilitaires.lire_tout, existant=utilitaires.existant, ecrire=utilitaires.ecrire, maintenant=utilitaires.maintenant,
    jeton=tv_cartes.jeton, par_jeton=tv_cartes.par_jeton, media_existant=utilitaires.media_existant, masquer_tout=masquer_tout,
    secrets=lambda t: secrets_dans(t, noms_caches.secrets_des_joueurs()), etat_table=lambda: tv_ecran.etat_table())
app.include_router(remis.router)


def fiche_ou_rien(dossier: Path, ident) -> dict | None:
    """La fiche, ou None : absente, illisible, ou (collection à auteur) d'un autre MJ que le lecteur."""
    if not isinstance(ident, str) or not config.ID_VALIDE.match(ident) or not (dossier / f"{ident}.json").is_file():
        return None
    if not cloisonnement.permis_chemin(dossier.name, dossier / f"{ident}.json"):
        return None
    try:
        return utilitaires.lire_fiche(dossier / f"{ident}.json")
    except HTTPException:
        return None


billets_prives = PrivesMJ(
    config.PROPOSITIONS, config.DONNEES, joueurs_lus=joueurs_mj.joueurs_lus, heros_des_joueurs=lambda: carnet_api.heros_des_joueurs(),
    tablee=lambda: [t for t in campagne_api.campagne().get("tablee") or [] if isinstance(t, dict)],
    lire_seance=lambda ident: fiche_ou_rien(config.SEANCES, ident), lire_document=lambda ident: fiche_ou_rien(config.DOCUMENTS, ident),
    masquer_tout=masquer_tout, candidats=lambda: noms_caches.secrets_des_joueurs(), retenir=carnet_api.retenir, secrets_dans=secrets_dans,
    noms_secrets=carnet_api.noms_secrets, image_source=lambda url: config.IMAGES / config.MEDIA_VALIDE.match(url).group(1) if utilitaires.media_existant(url) else None,
    sources=lambda: [config.JOUEURS, config.PROPOSITIONS / ".acces.json", noms_caches.NOM_AUBERGE, config.CAMPAGNE, *config.AVENTURIERS.glob("*.json"), *config.PROPOSITIONS.glob("*.json")],
    signaler=lambda message, pour=None: commandes_api.signaler_demandes(message, pour), comptes=lambda: adresses.ouverts(config.DONNEES))
app.include_router(billets_prives.routes(utilitaires.corps_objet))


@app.get("/api/table/precedemment/{j}")
def table_precedemment(j: str):
    seance = utilitaires.lire_fiche(tv_cartes.par_jeton(config.SEANCES, "seances", j))
    recit = utilitaires.texte(seance.get("precedemment")).strip()
    if not recit:
        raise HTTPException(404, "Introuvable")
    connus = tv_cartes.lieux_connus()
    images = []
    for lid in seance.get("lieux", []):
        if lid in connus:
            lieu = tv_cartes.lieu_public(connus[lid])
            if lieu["illustration"]:
                images.append({"url": lieu["illustration"], "nom": lieu["nom"]})
    return tv_cartes.reponse_publique({"id": j, "numero": seance.get("numero"), "texte": recit, "images": images})


def titre_episode(seance: dict) -> str:
    """Le titre que la TV annonce : celui choisi pour les joueurs, sinon le nom de la séance, toujours passé au masque."""
    titre = " ".join(utilitaires.texte(seance.get("titre_episode")).split()) or " ".join(utilitaires.texte(seance.get("nom")).split())
    return masquer(titre)


# Le carton-titre d'épisode : le numéro, le titre et une image de fond, rien d'autre de la séance. L'image est celle
# de la séance, sinon celle du premier de ses lieux connus des joueurs qui en a une ; sans elle, la TV prend un fond sombre.
@app.get("/api/table/episode/{j}")
def table_episode(j: str):
    seance = utilitaires.lire_fiche(tv_cartes.par_jeton(config.SEANCES, "seances", j))
    image = tv_cartes.url_publique(seance)
    if not utilitaires.media_existant(image):
        connus = tv_cartes.lieux_connus()
        lieux = [connus[lid] for lid in seance.get("lieux") or [] if isinstance(lid, str) and lid in connus]
        image = next((u for u in map(tv_cartes.url_publique, lieux) if utilitaires.media_existant(u)), None)
    numero = utilitaires.nombre(seance.get("numero"), 0.0)
    numero = int(numero) if numero >= 1 and numero.is_integer() else None
    episode = {"id": j, "numero": numero, "titre": titre_episode(seance), "image": image}
    # Une séance d'un MJ invité : « Quête annexe N » au lieu de « Épisode N ». Rien de plus sans invité.
    if (suite := carnet_api.suites_des_seances()(seance)) is not None:
        episode["suite"] = carnet_api.suite_publique(suite, noms_caches.secrets_des_joueurs())
    return tv_cartes.reponse_publique(episode)


def allure_publique(a: dict, candidats: list | None = None):
    """L'allure, que le joueur peut écrire depuis le coin (lore.py) : à la TV et dans le carnet, rien si elle nomme ce que
    les joueurs ne savent pas (un PNJ ou un lieu inconnu, un peuple caché, le sien compris : toute la tablée la lit). Le
    masque passe ensuite, comme sur tout ce qui part."""
    allure = a.get("allure")
    if not isinstance(allure, str) or not allure.strip():
        return allure
    return "" if secrets_dans(masquer(allure), noms_caches.secrets_des_joueurs() if candidats is None else candidats) else allure


def aventurier_public(a: dict, candidats: list | None = None) -> dict:
    # Ni l'histoire, ni les particularités, ni les dons (ils trahiraient un peuple gardé secret), ni rien de ce qui est « pour le MJ ».
    public = {k: a.get(k) for k in ("nom", "genre", "specialite", "element", "joueur")}
    public["allure"] = allure_publique(a, candidats)
    public |= {k: a.get(k) for k in ("niveau", "physique", "social", "mental", "sante", "psy")}
    public["id"] = tv_cartes.jeton("aventuriers", a["id"])
    couleur = utilitaires.texte(a.get("couleur"))
    public["couleur"] = couleur if re.fullmatch(r"#[0-9a-fA-F]{3,8}", couleur) else ""
    public["peuple"] = "" if a.get("peuple_cache") else a.get("peuple", "")
    public["vocations"] = list(a.get("vocations") or [])
    public["themes"] = [t for t in a.get("themes") or [] if t]
    public["illustration"] = tv_cartes.url_publique(a)
    return public


# Ce qu'un MJ invité lit d'un héros (routes de la tablée, recherche) : ce qu'il faut pour mener une partie, rien de ce que
# le joueur a confié au MJ principal. Liste blanche : ni les secrets du héros (proprietes.SECRETS_DES_HEROS), ni son récit
# (avant, pourquoi, défaut, liens, contacts, particularités : les réponses dont son histoire est tirée), ni le journal des
# niveaux, ni les notes des illustrations. Un peuple gardé secret part avec ce qui le trahit (dons, posture élémentaire,
# élément), comme à la TV. Passé au masque : le nom caché de l'auberge est un secret du kit.
CHAMPS_HEROS_INVITE = ("id", "nom", "genre", "joueur", "couleur", "niveau", "physique", "social", "mental", "sante", "psy",
                       "specialite", "vocations", "themes", "competences", "armes", "protection", "bouclier", "posture",
                       "langues", "equipement", "objets", "or", "tablee", "cree", "modifie")
TRAHISSENT_LE_PEUPLE = ("dons", "posture_elementaire", "element")


def heros_pour_l_invite(a: dict) -> dict:
    vu = {k: a[k] for k in CHAMPS_HEROS_INVITE if k in a}
    vu["peuple"] = "" if a.get("peuple_cache") else a.get("peuple", "")
    if not a.get("peuple_cache"):
        vu |= {k: a[k] for k in TRAHISSENT_LE_PEUPLE if k in a}
    vu["allure"] = allure_publique(a)
    vu["illustrations"] = [{"url": i["url"]} for i in a.get("illustrations") or []
                           if isinstance(i, dict) and not i.get("secrete") and isinstance(i.get("url"), str)]
    vu["illustration"] = tv_cartes.url_publique(a)
    return masquer_tout(vu)


@app.get("/api/table/aventurier/{j}")
def table_aventurier(j: str):
    a = utilitaires.lire_fiche(tv_cartes.par_jeton(config.AVENTURIERS, "aventuriers", j))
    return tv_cartes.reponse_publique(couleur_tv(aventurier_public(a), a, couleurs_de_la_tv()))


def tablee_des_aventuriers() -> list:
    tablee = [a for a in utilitaires.lire_tout(config.AVENTURIERS) if a.get("tablee") is not False and a.get("id")]
    tablee.sort(key=lambda a: utilitaires.texte(a.get("cree")))
    return tablee


def couleurs_de_la_tv() -> dict:
    """La couleur de chaque héros sur la TV (couleurs_tv.py) : lisible sur un plan sombre, et jamais celle d'un autre.
    La tablée d'abord, dans l'ordre d'arrivée : un héros hors de la tablée ne prend pas la couleur d'un présent."""
    tous = sorted((a for a in utilitaires.lire_tout(config.AVENTURIERS) if a.get("id")), key=lambda a: utilitaires.texte(a.get("cree")))
    return couleurs_tv.distinctes([a for a in tous if a.get("tablee") is not False] + [a for a in tous if a.get("tablee") is False])


def couleur_tv(public: dict, a: dict, couleurs: dict) -> dict:
    public["couleur"] = couleurs.get(a.get("id")) or public.get("couleur") or ""
    return public


def fiche_publique(a: dict, etats: dict | None = None, candidats: list | None = None) -> dict:
    """Les valeurs de jeu d'une fiche, pour la TV en partie. Les dons et la posture élémentaire ne partent pas quand
    le peuple est gardé secret : ils le trahiraient (même règle qu'aventurier_public). La Santé et la Psy du moment
    (l'état du héros) partent en nombres seuls, None au maximum ; jamais la note du MJ."""
    public = aventurier_public(a, candidats)
    etat = (etats if etats is not None else heros_etat.etats_heros()).get(a.get("id")) or {}
    for cle in ("sante", "psy"):
        v, m = etat.get(cle), a.get(cle)
        nombres = all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in (v, m))
        public[f"{cle}_actuelle"] = int(round(v)) if nombres and v < m else None

    def lignes(cle: str, champs: tuple) -> list:
        return [{k: x.get(k) for k in champs} for x in a.get(cle) or [] if isinstance(x, dict) and utilitaires.texte(x.get("nom")).strip()]

    public["competences"] = lignes("competences", ("nom", "bonus", "avec"))
    public["armes"] = lignes("armes", ("nom", "competence", "degats", "notes"))
    protection = a.get("protection") if isinstance(a.get("protection"), dict) else {}
    public["protection"] = {"nom": utilitaires.texte(protection.get("nom")), "indice": protection.get("indice")}
    public["bouclier"] = bool(a.get("bouclier"))
    public["posture"] = a.get("posture") if a.get("posture") in ("offensive", "defensive", "focus") else ""
    if a.get("peuple_cache"):
        public["dons"] = []
    else:
        public["dons"] = lignes("dons", ("nom", "cout", "effet", "cree", "ameliore"))
        public["posture_elementaire"] = utilitaires.texte(a.get("posture_elementaire"))
    return public


@app.get("/api/table/heros")
def table_heros():
    couleurs, candidats = couleurs_de_la_tv(), noms_caches.secrets_des_joueurs()
    return tv_cartes.reponse_publique([couleur_tv(aventurier_public(a, candidats), a, couleurs) for a in tablee_des_aventuriers()])


@app.get("/api/table/fiches")
def table_fiches():
    etats, couleurs, candidats = heros_etat.etats_heros(), couleurs_de_la_tv(), noms_caches.secrets_des_joueurs()
    return tv_cartes.reponse_publique([couleur_tv(fiche_publique(a, etats, candidats), a, couleurs) for a in tablee_des_aventuriers()])


# Modules qui se servent les uns des autres seulement à l'appel d'une route : importés ici, une fois les définitions
# posées, pour ne pas former de cycle au chargement.
from api import heros_etat, commandes_api, campagne_api, noms_caches, tv_ecran  # noqa: E402
