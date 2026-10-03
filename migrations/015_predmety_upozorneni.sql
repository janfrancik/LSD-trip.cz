-- 015_predmety_upozorneni.sql
--
-- Předmět interních upozornění dostává prefix [LSD], aby se v poště daly
-- odfiltrovat do štítku nebo složky. U přihlášky navíc přibývá termín -
-- z „Nová přihláška: Parašutistický výcvik" se nepozná, o který den jde,
-- a provoz to řeší jako první.
--
-- Obojí se přepisuje JEN tehdy, když je předmět pořád ve výchozí podobě.
-- Co si majitelka upravila, zůstává - texty e-mailů jsou její.

UPDATE email_sablony
   SET predmet = '[LSD] Nová poptávka: {{jmeno}}'
 WHERE klic = 'poptavka_provoz'
   AND predmet = 'Nová poptávka od {{jmeno}}';

UPDATE email_sablony
   SET predmet = '[LSD] Nová přihláška: {{kurz}}, {{termin}}'
 WHERE klic = 'prihlaska_provoz'
   AND predmet = 'Nová přihláška: {{kurz}} {{termin}}';
