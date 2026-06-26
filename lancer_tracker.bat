@echo off
title Tracker Platine Warframe - Serveur Actif
cls
echo ==================================================
echo  Demarrage du Tracker Platine Warframe...
echo ==================================================
echo.
echo  [1/2] Ouverture du navigateur...
start "" "http://localhost:8088"
echo.
echo  [2/2] Lancement du serveur avec cache local...
echo  (Laissez cette fenetre ouverte tant que vous utilisez le tracker)
echo  (Appuyez sur Ctrl+C ou fermez cette fenetre pour l'arreter)
echo.
node server.js
pause
