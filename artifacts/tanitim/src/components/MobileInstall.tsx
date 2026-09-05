/**
 * « Ajant Bureau sur votre telephone » — installation et acces par QR.
 *
 * Ce que cette section dit, et surtout ce qu'elle ne dit pas.
 *
 * L'application native (Expo) existe dans le depot mais n'est publiee sur
 * AUCUN magasin: la publication demande un compte Apple Developer (99 USD/an)
 * et un compte Play Console (25 USD), tous deux au nom du proprietaire. Poser
 * ici des boutons « App Store » et « Google Play » serait donc promettre un
 * telechargement qui n'existe pas — exactement le defaut qu'on a retire
 * ailleurs sur ce site (logos clients inventes, compteurs fabriques).
 *
 * Ce qui existe REELLEMENT aujourd'hui, et que cette section propose: la
 * version web est une application installable (manifeste `standalone`, icones
 * 192/512, service worker). Sur iPhone comme sur Android, elle s'ajoute a
 * l'ecran d'accueil et s'ouvre en plein ecran, sans barre de navigateur. Le QR
 * y mene directement.
 *
 * Le QR est un fichier SERVI PAR NOUS (`/qr-application.svg`), genere hors
 * ligne. Le faire produire par un service tiers (api.qrserver.com,
 * chart.googleapis.com...) transmettrait l'adresse IP de chaque visiteur a ce
 * tiers — la fuite meme que ce site vient de fermer avec la fonte Google.
 */
export function MobileInstall() {
  return (
    <section id="mobile" className="py-24 bg-background">
      <div className="container mx-auto px-4">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Ajant Bureau sur votre téléphone
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Scannez le code, ajoutez l'application à votre écran d'accueil, et
              retrouvez vos appels, devis et chantiers en plein écran — comme une
              application installée.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-10 items-center">
            <div className="flex flex-col items-center">
              <div className="bg-white p-5 rounded-2xl shadow-lg border">
                <img
                  src="/qr-application.svg"
                  alt="Code QR menant à app.agentdebureau.fr, l'application Ajant Bureau"
                  width={240}
                  height={240}
                  className="w-60 h-60"
                />
              </div>
              <a
                href="https://app.agentdebureau.fr"
                className="mt-4 text-sm font-medium underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                app.agentdebureau.fr
              </a>
            </div>

            <div className="space-y-6">
              <div>
                <h3 className="font-semibold mb-2">Sur iPhone</h3>
                <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                  <li>Ouvrez le lien dans Safari</li>
                  <li>Touchez le bouton Partager</li>
                  <li>Choisissez « Sur l'écran d'accueil »</li>
                </ol>
              </div>

              <div>
                <h3 className="font-semibold mb-2">Sur Android</h3>
                <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                  <li>Ouvrez le lien dans Chrome</li>
                  <li>Menu ⋮ puis « Installer l'application »</li>
                </ol>
              </div>

              {/*
                Dit avant, et non decouvert apres. Un visiteur qui cherche
                l'application sur l'App Store ne doit pas conclure qu'elle a ete
                retiree, ni que le produit n'existe pas.
              */}
              <p className="text-sm text-muted-foreground border-l-2 pl-4">
                L'application est installée depuis le navigateur : elle n'est pas
                encore publiée sur l'App Store ni sur Google Play. La version
                installée fonctionne hors connexion pour la consultation et se met
                à jour toute seule.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
