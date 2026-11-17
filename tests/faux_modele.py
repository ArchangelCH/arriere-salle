"""Un faux client de l'API pour les tests : réponses données d'avance, appels notés, aucun réseau."""
from types import SimpleNamespace


def usage(entree=1000, sortie=200, ecrit=0, lu=0):
    return SimpleNamespace(input_tokens=entree, output_tokens=sortie, cache_creation_input_tokens=ecrit,
                           cache_read_input_tokens=lu, cache_creation=None)


def message(texte, arret="end_turn"):
    return SimpleNamespace(stop_reason=arret, model="claude-opus-5-5", usage=usage(),
                           content=[SimpleNamespace(type="text", text=texte)])


class Flux:
    def __init__(self, morceaux, arret):
        self.morceaux, self.arret = morceaux, arret

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    @property
    def text_stream(self):
        async def suite():
            for m in self.morceaux:
                yield m
        return suite()

    async def get_final_message(self):
        return message("".join(self.morceaux), self.arret)


class Lots:
    def __init__(self, client):
        self.client, self.crees = client, []

    async def create(self, requests):
        self.crees.append(requests)
        return SimpleNamespace(id=f"lot_{len(self.crees)}")

    async def retrieve(self, ident):
        return SimpleNamespace(processing_status="ended")

    async def results(self, ident):
        texte = self.client.reponses.pop(0) if self.client.reponses else ""

        async def suite():
            yield SimpleNamespace(custom_id="x", result=SimpleNamespace(type="succeeded", message=message(texte)))
        return suite()


class FauxClient:
    """reponses : textes rendus dans l'ordre (create, stream ou lot). erreur : levée à chaque appel."""

    def __init__(self, *reponses, erreur=None, arret="end_turn"):
        self.reponses, self.erreur, self.arret, self.appels = list(reponses), erreur, arret, []
        self.beta = SimpleNamespace(messages=self)
        self.messages = SimpleNamespace(batches=Lots(self))

    def _suivante(self, kwargs):
        self.appels.append(kwargs)
        if self.erreur:
            raise self.erreur
        return self.reponses.pop(0) if self.reponses else ""

    async def create(self, **kwargs):
        return message(self._suivante(kwargs), self.arret)

    def stream(self, **kwargs):
        texte = self._suivante(kwargs)
        return Flux([texte[i:i + 7] for i in range(0, len(texte), 7)], self.arret)
