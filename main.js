// ==UserScript==
// @name         Kanri - Inteligentny podział aut + Rozpiska v19.0
// @namespace    http://tampermonkey.net/
// @version      19.0
// @description  Poprawka błędu SyntaxError/ReferenceError w wyliczaniu Cap, dedykowany profil "Opony" (tylko czyste wymiany kół/opon), ciasny Cap (10%+10pt), GR Yaris/Supra, EV 25%, pracownicy [PRAC], Tryb Sobota i eksport HTML.
// @author       Mikołaj
// @match        https://kanri.aasys.pl/*
// @updateURL    https://raw.githubusercontent.com/Awq1337/podzial-kanri/main/main.js
// @downloadURL  https://raw.githubusercontent.com/Awq1337/podzial-kanri/main/main.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const API_URL = 'https://kanri.aasys.pl/index.jsf';
    let currentMode = 'podzial'; // 'podzial' lub 'rozpiska'
    let selectedDayOffset = 0;   // 0 = Dzisiaj, 1 = Jutro
    let isSaturdayMode = false;  // Tryb Sobotni

    // Lista doradców do rozwijanej listy w UI oraz dopasowań
    const PASSENGER_ADVISORS = [
        "Mikołaj Falkowski",
        "Paweł Okoński",
        "Olaf Machander",
        "Paweł Kurowski",
        "Michał Smażewski",
        "Rafał Krzyszowski",
        "Norbert Longier",
        "Maksymilian Borecki",
        "Michał Gryglicki",
        "Kornel Sycz",
        "Bartosz Jurusz",
        "Jakub Leczycki",
        "Paweł Kowalczyk",
        "Przemysław Frankiewicz",
        "Paweł Sołtysik",
        "Kuba Jezierski"
    ];

    // Doradcy dedykowani do aut dostawczych w sobotę
    const PROFESSIONAL_ADVISORS = [
        "Przemysław Frankiewicz",
        "Paweł Sołtysik",
        "Kuba Jezierski"
    ];

    function getViewState() {
        const viewStateElement = document.querySelector('input[name="javax.faces.ViewState"]');
        return viewStateElement ? encodeURIComponent(viewStateElement.value) : '';
    }

    function getToken() {
        const tokenElement = document.querySelector('input[name="token"]');
        return tokenElement ? encodeURIComponent(tokenElement.value) : '6faa98257c3a4710a220af6b2a7c1cff';
    }

    function removePolishAccents(str) {
        if (!str) return '';
        return str
            .toUpperCase()
            .replace(/Ł/g, 'L')
            .replace(/Ś/g, 'S')
            .replace(/Ć/g, 'C')
            .replace(/Ż/g, 'Z')
            .replace(/Ź/g, 'Z')
            .replace(/Ą/g, 'A')
            .replace(/Ę/g, 'E')
            .replace(/Ó/g, 'O')
            .replace(/Ń/g, 'N');
    }

    // PANCERNE ŚCISŁE DOPASOWANIE IMIENIA I NAZWISKA
    function isAdvisorMatch(userInput, systemString) {
        if (!systemString || !userInput) return false;

        const cleanSys = removePolishAccents(systemString);
        const cleanUsr = removePolishAccents(userInput);

        const sysWords = cleanSys.replace(/[^A-Z]/g, ' ').split(/\s+/).filter(w => w.length > 0);
        const usrWords = cleanUsr.replace(/[^A-Z]/g, ' ').split(/\s+/).filter(w => w.length > 0);

        if (usrWords.length < 2 || sysWords.length < 2) {
            return usrWords.every(uw => sysWords.some(sw => sw === uw));
        }

        return usrWords.every(uw => sysWords.some(sw => sw === uw || sw.startsWith(uw) || uw.startsWith(sw)));
    }

    function matchWithPassengerAdvisors(systemString) {
        if (!systemString) return '';
        for (const fullName of PASSENGER_ADVISORS) {
            if (isAdvisorMatch(fullName, systemString)) {
                return fullName;
            }
        }
        return '';
    }

    function isProfessionalAdvisor(advisorName) {
        return PROFESSIONAL_ADVISORS.some(pAdv => isAdvisorMatch(pAdv, advisorName));
    }

    async function fetchVehiclePlates(advisorsConfig) {
        try {
            const currentViewState = getViewState();
            if (!currentViewState) {
                console.warn('Nie znaleziono javax.faces.ViewState!');
            }

            let requestBody = '';

            if (selectedDayOffset === 1) {
                const token = getToken();
                requestBody = `javax.faces.partial.ajax=true&javax.faces.source=serviceWorkSchedule%3AaddDay&aas%3Ac-region=MAIN&javax.faces.partial.execute=serviceWorkSchedule%3AaddDay&javax.faces.partial.render=serviceWorkSchedule&serviceWorkSchedule%3AaddDay=serviceWorkSchedule%3AaddDay&aas%3Ad-region=%40all&token=${token}&validate=true&validateClient=true&javax.faces.ViewState=${currentViewState}`;
            } else {
                requestBody = `javax.faces.partial.ajax=true&javax.faces.source=remoteCommands%3Aremote_changeView&aas%3Ac-region=&javax.faces.partial.execute=%40all&remoteCommands%3Aremote_changeView=remoteCommands%3Aremote_changeView&view=carservice%2Fservice-work-schedule&viewIdAndContextDefinition=mBBS129-BbbL&params=&isReload=false&remoteCommands=remoteCommands&remoteCommands%3Atoken=ef2dd0ee97d349b599923979e56c86f8&javax.faces.ViewState=${currentViewState}`;
            }

            const response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Accept': 'application/xml, text/xml, */*; q=0.01',
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'Faces-Request': 'partial/ajax',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: requestBody
            });

            if (!response.ok) {
                throw new Error(`Błąd HTTP: ${response.status}`);
            }

            const xmlText = await response.text();
            processData(xmlText, advisorsConfig);

        } catch (error) {
            console.error('Błąd podczas zapytania:', error);
            alert('Wystąpił błąd komunikacji z serwerem. Sprawdź konsolę.');
        }
    }

    function calculateCalories(category, kmVal, isFleet, isEV) {
        let base = 0;
        if (category === 'DUZY_PRZEGLAD') {
            if (kmVal === 90 || kmVal === 120 || kmVal === 150 || kmVal === 180) base = 85;
            else if (kmVal === 60) base = 70;
            else if (kmVal >= 210) base = 60;
            else if (kmVal === 30 || kmVal === 20) base = 50;
            else base = 65;
        } else if (category === 'MALY_PRZEGLAD') {
            if (kmVal >= 75) base = 40;
            else if (kmVal >= 45) base = 30;
            else base = 20;
        } else if (category === 'WERYFIKACJA' || category === 'OTHER') {
            base = 0;
        }

        if (isEV && base > 0) {
            base = Math.round(base * 0.25);
        }

        if (isFleet && base > 0) {
            base = Math.round(base * 0.25);
        }

        return base;
    }

    function categorizeService(serviceText, isKinto = false, isContinuation = false, modelText = '') {
        if (!serviceText && !isKinto) return { category: 'OTHER', tag: 'I', isFleet: false, kmVal: 0, calories: 0, isEmployee: false, isTires: false, isEV: false };
        
        const text = (serviceText || '').toUpperCase();
        const modelUpper = (modelText || '').toUpperCase();
        const isFleet = text.includes('PCC') || isKinto;

        const isGRYaris = /GR\s*YARIS|YARIS\s*GR/.test(modelUpper) || /GR\s*YARIS|YARIS\s*GR/.test(text);
        const isSupra = /SUPRA|GR\s*SUPRA/.test(modelUpper) || /SUPRA|GR\s*SUPRA/.test(text);

        const isEV = /BZ4X|BZ3|BZ3X|BZ3C|C-HR\+|URBAN CRUISER|ELECTRIC|BEV|\bEV\b|ELEKTRYCZ/.test(modelUpper) || 
                     /ELECTRIC|BEV|\bEV\b|ELEKTRYCZN|ELEKTRYK/.test(text);

        const evPrefix = isEV ? 'E' : '';
        const fleetPrefix = isFleet ? 'F' : '';
        const combinedPrefix = `${evPrefix}${fleetPrefix}`;

        const isEmployee = /PRACOWNIK|PRACOWNICZ|PRACOWNIKOW/.test(text);
        if (isEmployee) {
            let calories = calculateCalories('OTHER', 0, isFleet, isEV);
            return { category: 'OTHER', tag: 'PRAC', isFleet, kmVal: 0, calories, isEmployee: true, isTires: false, isEV };
        }

        if (isContinuation) {
            let calories = calculateCalories('OTHER', 0, isFleet, isEV);
            return { category: 'OTHER', tag: 'I', isFleet, kmVal: 0, calories, isEmployee: false, isTires: false, isEV };
        }

        const isTiresService = /WYMIANA\s+OPON|SEZONOWA\s+WYMIANA|WYMIANA\s+KÓŁ|WYMIANA\s+KOL|\bOPON\b|\bOPONY\b|\bKOŁA\b|\bKOLA\b/.test(text);

        if (text.includes('WERYFIKACJ')) {
            let calories = calculateCalories('WERYFIKACJA', 0, isFleet, isEV);
            return { category: 'WERYFIKACJA', tag: 'W', isFleet, kmVal: 0, calories, isEmployee: false, isTires: isTiresService, isEV };
        }

        // PRIORYTET DLA SUPRY
        if (isSupra) {
            const numMatchSupra = text.match(/(?:OT|PRZEGLĄD|PRZEGLAD|PRZEGL)[^\d]*(\d{2,3})\b/);
            let val = numMatchSupra ? parseInt(numMatchSupra[1], 10) : 30;
            let calories = calculateCalories('DUZY_PRZEGLAD', val, isFleet, isEV);
            return { category: 'DUZY_PRZEGLAD', tag: `${combinedPrefix}D${val}`, isFleet, kmVal: val, calories, isEmployee: false, isTires: isTiresService, isEV };
        }

        // PRIORYTET DLA GR YARISA (10k/20k)
        if (isGRYaris) {
            let val = 10;
            const numMatchGR = text.match(/(\d{1,3})\s*(?:000|\s*000|K|KKM|KM)/) || text.match(/(?:OT|PRZEGLĄD|PRZEGLAD|PRZEGL)[^\d]*(\d{1,3})\b/);
            if (numMatchGR) {
                val = parseInt(numMatchGR[1], 10);
            }
            
            let isDuzy = (val % 20 === 0);
            let cat = isDuzy ? 'DUZY_PRZEGLAD' : 'MALY_PRZEGLAD';
            let prefix = isDuzy ? 'D' : 'M';
            let calories = calculateCalories
