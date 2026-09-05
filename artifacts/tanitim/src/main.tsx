import { createRoot } from "react-dom/client";
import App from "./App";
// Inter, servie par nos soins: les quatre graisses reellement utilisees
// (400/500/600/700), pas la famille entiere. Importee ici plutot que dans
// index.html pour que Vite empaquette les .woff2 et les serve depuis notre
// propre domaine — aucune requete vers Google, donc aucune adresse IP
// transmise a un tiers avant consentement. Le tribunal regional de Munich
// (LG Munchen I, 3 O 17493/20) a juge ce seul appel suffisant pour
// caracteriser une atteinte.
//
// Cette explication vivait aussi dans index.html, en commentaire HTML. Les
// commentaires HTML ne sont pas retires a la compilation: elle partait donc
// dans CHAQUE reponse, a chaque visiteur, et publiait sur le site de
// production le recit d'un defaut de confidentialite passe. Elle appartient
// au code, pas a la page.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
