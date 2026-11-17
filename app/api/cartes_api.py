"""Les cartes : liste, création, enregistrement."""

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

from mj import proprietes

from api.application import app


@app.post("/api/cartes")
async def creer_carte(requete: Request):
    carte = await utilitaires.corps_objet(requete)
    if not carte.get("nom") or not carte.get("terrain"):
        raise HTTPException(400, "Une carte a besoin d'un nom et d'un terrain")
    carte["id"] = utilitaires.nouvel_id(config.CARTES, utilitaires.texte(carte["nom"]))
    carte["cree"] = carte["modifie"] = utilitaires.maintenant()
    proprietes.poser_auteur(carte)
    proprietes.partage_propre("cartes", carte)
    utilitaires.ecrire(config.CARTES / f"{carte['id']}.json", carte)
    return {"id": carte["id"], "modifie": carte["modifie"]}


@app.get("/api/cartes/{ident}")
def lire_carte(ident: str):
    return JSONResponse(utilitaires.lire_fiche(utilitaires.existant(config.CARTES, ident)))


@app.put("/api/cartes/{ident}")
async def enregistrer_carte(ident: str, requete: Request):
    chemin = utilitaires.existant(config.CARTES, ident)
    carte = await utilitaires.corps_objet(requete)
    precedente = utilitaires.lire_fiche(chemin)
    # Deux écrans ouverts sur la même carte : le plus ancien ne doit pas écraser le plus récent.
    if carte.pop("version_base", None) != precedente.get("modifie"):
        raise HTTPException(409, "Cette carte a été modifiée depuis un autre écran : rechargez-la avant de continuer.")
    carte["id"] = ident
    carte["cree"] = precedente.get("cree")
    proprietes.garder_auteur(carte, precedente)
    proprietes.partage_propre("cartes", carte)
    carte["modifie"] = utilitaires.maintenant()
    utilitaires.archiver(chemin, "cartes")
    utilitaires.ecrire(chemin, carte)
    fiches_api.coin_suit("cartes", ident)
    return {"id": ident, "modifie": carte["modifie"]}


@app.delete("/api/cartes/{ident}")
def supprimer_carte(ident: str):
    utilitaires.jeter(utilitaires.existant(config.CARTES, ident), "cartes")
    return {"ok": True}


# Modules qui se servent les uns des autres seulement à l'appel d'une route : importés ici, une fois les définitions
# posées, pour ne pas former de cycle au chargement.
from api import config, utilitaires, fiches_api  # noqa: E402
