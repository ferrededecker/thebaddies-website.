THE BADDIES — WEBSITE + SHOP

BELANGRIJK
Deze versie kan de beheerwijzigingen en bestellingen blijvend bewaren met Supabase, ook op een gratis Render web service.
Op Render hoef je hiervoor geen Persistent Disk te kopen.

EENMALIGE INSTELLING
1. Maak een Supabase-project.
2. Open SQL Editor in Supabase.
3. Open SUPABASE-SETUP.sql uit deze map en voer alles uit.
4. Zoek in Supabase je Project URL en de server-side key (service role key).
   Deel die sleutel nooit publiekelijk en zet hem alleen in Render als Environment Variable.
5. Zet in Render bij Environment deze variabelen:
   SUPABASE_URL = je project URL
   SUPABASE_SERVICE_ROLE_KEY = je server-side/service-role key
   SUPABASE_ASSETS_BUCKET = site-assets
   DATA_DIR mag blijven staan zoals het is; Supabase is de permanente opslag.
6. Render zal opnieuw deployen.

Daarna:
- De pagina "Website aanpassen" blijft hetzelfde.
- Teksten en prijzen worden in Supabase bewaard.
- Nieuwe foto's worden naar de Supabase bucket "site-assets" geüpload.
- Bestellingen kunnen ook in Supabase worden bewaard.

VEILIGHEID
De SUPABASE_SERVICE_ROLE_KEY hoort alleen in Render Environment Variables te staan.
Zet deze sleutel nooit in index.html, GitHub-bestanden of in een screenshot.

BETALINGEN
De Mollie-betalingen zijn in deze versie nog afhankelijk van MOLLIE_API_KEY en BASE_URL in Render. Het instellen/testen van betalingen is een aparte stap.
