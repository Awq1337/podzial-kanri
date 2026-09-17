// ==UserScript==
// @name         Kanri - Inteligentny podział aut + Rozpiska v17.5
// @namespace    http://tampermonkey.net/
// @version      17.6
// @description  Obsługa GR Yaris (10k/20k), Supra (tylko Duże D), elektryki EV 25%, opony [O], pracownicy [PRAC], filtr dostawczych i eksport HTML.
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

    // Lista doradców osobówek zapisana na twardo
    const PASSENGER_ADVISORS = [
        "Mikołaj Falkowski",
        "Paweł Okoński",
        "Paweł Kurowski",
        "Paweł Kowalczyk",
        "Michał Gryglicki",
        "Norbert Longier",
        "Maksymilian Borecki",
        "Rafał Krzyszowski",
        "Jakub Leczycki",
        "Kornel Sycz",
        "Bartosz Jurusz",
        "Olaf Machander",
        "Michał Smażewski"
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

    function isAdvisorMatch(userInput, systemString) {
        if (!systemString || !userInput) return false;

        const cleanSys = removePolishAccents(systemString);
        const cleanUsr = removePolishAccents(userInput);

        const sysWords = cleanSys.replace(/[^A-Z]/g, ' ').split(/\s+/).filter(w => w.length > 0);
        const usrWords = cleanUsr.replace(/[^A-Z]/g, ' ').split(/\s+/).filter(w => w.length > 0);

        if (usrWords.length === 0 || sysWords.length === 0) return false;

        return usrWords.every(uw => sysWords.some(sw => sw.startsWith(uw) || uw.startsWith(sw) || sw === uw));
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

        // WYKRYWANIE MODELI SPECJALNYCH: GR YARIS ORAZ SUPRA
        const isGRYaris = /GR\s*YARIS|YARIS\s*GR/.test(modelUpper) || /GR\s*YARIS|YARIS\s*GR/.test(text);
        const isSupra = /SUPRA|GR\s*SUPRA/.test(modelUpper) || /SUPRA|GR\s*SUPRA/.test(text);

        const isEV = /BZ4X|BZ3|BZ3X|BZ3C|C-HR\+|URBAN CRUISER|ELECTRIC|BEV|\bEV\b|ELEKTRYCZ/.test(modelUpper) ||
                     /ELECTRIC|BEV|\bEV\b|ELEKTRYCZN|ELEKTRYK/.test(text);

        const evPrefix = isEV ? 'E' : '';
        const fleetPrefix = isFleet ? 'F' : '';
        const combinedPrefix = `${evPrefix}${fleetPrefix}`;

        // ROZPOZNAWANIE AUT PRACOWNICZYCH
        const isEmployee = /PRACOWNIK|PRACOWNICZ|PRACOWNIKOW/.test(text);
        if (isEmployee) {
            let calories = calculateCalories('OTHER', 0, isFleet, isEV);
            return { category: 'OTHER', tag: 'PRAC', isFleet, kmVal: 0, calories, isEmployee: true, isTires: false, isEV };
        }

        if (isContinuation) {
            let calories = calculateCalories('OTHER', 0, isFleet, isEV);
            return { category: 'OTHER', tag: 'I', isFleet, kmVal: 0, calories, isEmployee: false, isTires: false, isEV };
        }

        // WYKRYWANIE WYMIANY OPON
        const isTiresService = /WYMIANA\s+OPON|SEZONOWA\s+WYMIANA|WYMIANA\s+KÓŁ|WYMIANA\s+KOL|\bOPON\b|\bOPONY\b|\bKOŁA\b|\bKOLA\b/.test(text);

        if (text.includes('WERYFIKACJ')) {
            let calories = calculateCalories('WERYFIKACJA', 0, isFleet, isEV);
            return { category: 'WERYFIKACJA', tag: 'W', isFleet, kmVal: 0, calories, isEmployee: false, isTires: isTiresService, isEV };
        }

        // LOGIKA DLA SUPRY: Wszystkie przeglądy są DUŻE [D]
        if (isSupra) {
            const numMatchSupra = text.match(/(?:OT|PRZEGLĄD|PRZEGLAD|PRZEGL)[^\d]*(\d{2,3})\b/);
            let val = numMatchSupra ? parseInt(numMatchSupra[1], 10) : 30;
            let calories = calculateCalories('DUZY_PRZEGLAD', val, isFleet, isEV);
            return { category: 'DUZY_PRZEGLAD', tag: `${combinedPrefix}D${val}`, isFleet, kmVal: val, calories, isEmployee: false, isTires: isTiresService, isEV };
        }

        // LOGIKA DLA GR YARIS: Małe co 10k, Duże co 20k
        if (isGRYaris) {
            const numMatchGR = text.match(/(?:OT|PRZEGLĄD|PRZEGLAD|PRZEGL)[^\d]*(\d{1,3})\b/);
            if (numMatchGR) {
                let val = parseInt(numMatchGR[1], 10);
                let isDuzy = (val % 20 === 0);
                let cat = isDuzy ? 'DUZY_PRZEGLAD' : 'MALY_PRZEGLAD';
                let prefix = isDuzy ? 'D' : 'M';
                let calories = calculateCalories(cat, val, isFleet, isEV);
                return { category: cat, tag: `${combinedPrefix}${prefix}${val}`, isFleet, kmVal: val, calories, isEmployee: false, isTires: isTiresService, isEV };
            }
        }

        // Domyślne interwały dla pozostałych aut
        const oddYearsWordMap = [
            { rx: /PIERWSZYM|JEDNYM\s+ROKU/, val: '1rok', years: 1 },
            { rx: /TRZECIM|TRZECH/, val: '3lata', years: 3 },
            { rx: /PIĄTYM|PIATYM|PIĘCIU|PIECIU/, val: '5lat', years: 5 },
            { rx: /SIÓDMYM|SIODMYM|SIEDMIU/, val: '7lat', years: 7 },
            { rx: /DZIEWIĄTYM|DZIEWIATYM|DZIEWIĘCIU|DZIEWIECIU/, val: '9lat', years: 9 },
            { rx: /JEDENASTYM/, val: '11lat', years: 11 },
            { rx: /TRZYNASTYM/, val: '13lat', years: 13 },
            { rx: /PIĘTNASTYM|PIETNASTYM/, val: '15lat', years: 15 }
        ];

        for (let item of oddYearsWordMap) {
            if (text.match(item.rx)) {
                let kmVal = item.years * 15;
                let calories = calculateCalories('MALY_PRZEGLAD', kmVal, isFleet, isEV);
                return { category: 'MALY_PRZEGLAD', tag: `${combinedPrefix}M${item.val}`, isFleet, kmVal, calories, isEmployee: false, isTires: isTiresService, isEV };
            }
        }

        const evenYearsWordMap = [
            { rx: /DRUGIM|DWÓCH|DWOCH|DWU/, val: '2lata', years: 2 },
            { rx: /CZWARTYM|CZTERECH/, val: '4lata', years: 4 },
            { rx: /SZÓSTYM|SZOSTYM|SZEŚCIU|SZESCIU/, val: '6lat', years: 6 },
            { rx: /ÓSMYM|OSMYM|OŚMIU|OSMIU/, val: '8lat', years: 8 },
            { rx: /DZIESIĄTYM|DZIESIATYM|DZIESIĘCIU|DZIESIECIU/, val: '10lat', years: 10 },
            { rx: /DWUNASTYM/, val: '12lat', years: 12 },
            { rx: /CZTERNASTYM/, val: '14lat', years: 14 }
        ];

        for (let item of evenYearsWordMap) {
            if (text.match(item.rx)) {
                let kmVal = item.years * 15;
                let calories = calculateCalories('DUZY_PRZEGLAD', kmVal, isFleet, isEV);
                return { category: 'DUZY_PRZEGLAD', tag: `${combinedPrefix}D${item.val}`, isFleet, kmVal, calories, isEmployee: false, isTires: isTiresService, isEV };
            }
        }

        const yearDigitMatch = text.match(/(?:PO|PRZEGLĄD|PRZEGLAD|PRZEGL)[^\d]*(\d{1,2})\s*(?:LAT|LATACH|LATAM|ROKU|L)/);
        if (yearDigitMatch) {
            const years = parseInt(yearDigitMatch[1], 10);
            if (years > 0 && years <= 35) {
                let suffix = (years === 1) ? 'rok' : ([2,3,4].includes(years % 10) && ![12,13,14].includes(years) ? 'lata' : 'lat');
                let cat = (years % 2 === 0) ? 'DUZY_PRZEGLAD' : 'MALY_PRZEGLAD';
                let prefix = (years % 2 === 0) ? 'D' : 'M';
                let kmVal = years * 15;
                let calories = calculateCalories(cat, kmVal, isFleet, isEV);
                return { category: cat, tag: `${combinedPrefix}${prefix}${years}${suffix}`, isFleet, kmVal, calories, isEmployee: false, isTires: isTiresService, isEV };
            }
        }

        const numMatch = text.match(/(?:OT|PRZEGLĄD|PRZEGLAD|PRZEGL)[^\d]*(\d{2,3})\b/);
        if (numMatch) {
            const val = parseInt(numMatch[1], 10);
            if (val > 0 && val <= 510) {
                let isDuzy = (val % 30 === 0);
                let cat = isDuzy ? 'DUZY_PRZEGLAD' : 'MALY_PRZEGLAD';
                let prefix = isDuzy ? 'D' : 'M';
                let calories = calculateCalories(cat, val, isFleet, isEV);
                return { category: cat, tag: `${combinedPrefix}${prefix}${val}`, isFleet, kmVal: val, calories, isEmployee: false, isTires: isTiresService, isEV };
            }
        }

        if (isTiresService) {
            let calories = calculateCalories('OTHER', 0, isFleet, isEV);
            return { category: 'OTHER', tag: 'O', isFleet, kmVal: 0, calories, isEmployee: false, isTires: true, isEV };
        }

        let calories = calculateCalories('OTHER', 0, isFleet, isEV);
        return { category: 'OTHER', tag: 'I', isFleet, kmVal: 0, calories, isEmployee: false, isTires: false, isEV };
    }

    function shortenGroupName(groupName) {
        let name = groupName.toUpperCase().trim();
        if (name.includes('EXPRES') || name.includes('EXPRESS')) {
            let numMatch = name.match(/\d+/);
            let num = numMatch ? numMatch[0] : '';
            return num ? `${num}-ES` : 'ES';
        }
        if (name.includes('DIAGNOSTYK')) {
            return 'D';
        }
        return name;
    }

    function getTagHTML(category, tag) {
        if (tag === 'PRAC') return `<span style="color:#27ae60; font-weight:bold;">[PRAC]</span>`;
        if (tag === 'O') return `<span style="color:#8e44ad; font-weight:bold;">[O]</span>`;
        if (category === 'WERYFIKACJA') return `<span style="color:#e67e22; font-weight:bold;">[${tag}]</span>`;
        if (category === 'MALY_PRZEGLAD') return `<span style="color:#3498db; font-weight:bold;">[${tag}]</span>`;
        if (category === 'DUZY_PRZEGLAD') return `<span style="color:#9b59b6; font-weight:bold;">[${tag}]</span>`;
        return `<span style="color:#95a5a6; font-weight:bold;">[${tag}]</span>`;
    }

    function isEligible(adv, startHour, carCategory, isFleetCar, kmVal) {
        let timeMatch = false;
        if (adv.shift === 1 && startHour < 13) timeMatch = true;
        if (adv.shift === 2 && startHour >= 9 && startHour < 14) timeMatch = true;
        if (adv.shift === 3 && startHour >= 13 && startHour <= 21) timeMatch = true;
        if (adv.shift === 4 && startHour >= 7 && startHour <= 15) timeMatch = true;

        if (!timeMatch) return false;

        if (adv.isFleetOnly) {
            if (carCategory === 'MALY_PRZEGLAD' || carCategory === 'DUZY_PRZEGLAD') {
                return isFleetCar && kmVal <= 75;
            }
        }

        return true;
    }

    function getHourlyCarCount(advisorName, assignmentMap, hour) {
        const list = assignmentMap[advisorName] || [];
        return list.filter(car => car.startHour === hour).length;
    }

    function getAdvisorFleetCount(advisorName, assignmentMap) {
        const list = assignmentMap[advisorName] || [];
        return list.filter(car => car.isFleet).length;
    }

    function getAdvisorPrivateCalories(advisorName, assignmentMap) {
        const list = assignmentMap[advisorName] || [];
        return list.filter(car => !car.isFleet).reduce((sum, c) => sum + c.calories, 0);
    }

    function canHandleLexus(advisorName) {
        const allowed = ["LONGIER", "OKOŃSKI", "BORECKI", "SYCZ"];
        const upper = advisorName.toUpperCase();
        return allowed.some(name => upper.includes(name));
    }

    function processData(xmlData, advisorsConfig) {
        const plateBlacklist = ['URLOP', 'HALA', 'SERWIS', 'EXPRES', 'SZKOLENIE', 'ZMIANA', 'L4', 'TEST', 'BRAK'];
        const tooltipMap = new Map();

        const ulRegex = /<div[^>]*class="[^"]*ui-tooltip-text[^"]*"[^>]*><ul>([\s\S]*?)<\/ul><\/div>/g;
        let ulMatch;
        while ((ulMatch = ulRegex.exec(xmlData)) !== null) {
            const ulContent = ulMatch[1];

            const plateMatch = ulContent.match(/<li>Nr rejestrac\.:\s*([^<]+)<\/li>/);
            const modelMatch = ulContent.match(/<li>Model\s*([^<]+)<\/li>/i);
            const vinMatch = ulContent.match(/<li>VIN:\s*([^<]+)<\/li>/i);
            const zgloszMatch = ulContent.match(/<li>Zgłosz\.:\s*([^<]+)<\/li>/i);

            const advMatch = ulContent.match(/<li>Przyjmujący zgłoszenie:\s*([^<]+)<\/li>/);
            const leadMatch = ulContent.match(/<li>Prowadzący(?:\szlecenie)?:\s*([^<]+)<\/li>/i);
            const serviceMatch = ulContent.match(/<li>Uzgodn\.zakr\.usług:\s*(?:<br\s*\/?>)?([\s\S]*?)<\/li>/i);

            let modelText = modelMatch ? modelMatch[1].toUpperCase().trim() : '';
            let plateStr = '';

            if (plateMatch && plateMatch[1].trim().length > 0) {
                plateStr = plateMatch[1].toUpperCase().replace(/\s/g, '');
            } else if (zgloszMatch) {
                let rawZgl = zgloszMatch[1].trim();
                let cleanNumMatch = rawZgl.match(/0*(\d+)/);
                let numOnly = cleanNumMatch ? cleanNumMatch[1] : rawZgl;
                plateStr = `ZGŁ.${numOnly}`;
            } else if (modelText.length > 0) {
                let shortModel = modelText.replace(/KOMBI|SEDAN|HATCHBACK|SUV/g, '').replace(/\s+/g, ' ').trim();
                plateStr = `[${shortModel}]`;
            } else if (vinMatch) {
                plateStr = `[VIN:${vinMatch[1].trim().slice(-6)}]`;
            }

            if (plateStr) {
                let rawSystemAdv = advMatch ? advMatch[1].replace(/&nbsp;|\xa0/g, ' ').trim() : '';
                let rawLeadAdv = leadMatch ? leadMatch[1].replace(/&nbsp;|\xa0/g, ' ').trim() : '';

                let systemAdvisor = matchWithPassengerAdvisors(rawSystemAdv);
                let leadAdvisor = matchWithPassengerAdvisors(rawLeadAdv);

                let isContinuation = false;
                let finalAdvisor = systemAdvisor;

                if (leadAdvisor !== '') {
                    finalAdvisor = leadAdvisor;
                    isContinuation = true;
                }

                let isKinto = ulContent.toUpperCase().includes('KINTO');

                let serviceText = serviceMatch ? serviceMatch[1].replace(/<[^>]*>?/gm, ' ').trim() : '';
                let serviceResult = categorizeService(serviceText, isKinto, isContinuation, modelText);

                let hasReplacementCar = /ZASTĘPCZ|ZASTEPCZ|AUTO ZAS|POJAZD ZAS/.test(ulContent.toUpperCase());

                let cleanModel = modelText.replace(/[\s\xa0]+/g, '');
                let isLexus = false;
                if (cleanModel.includes('LEXUS')) {
                    isLexus = true;
                } else {
                    isLexus = /^(RX|NX|ES|IS|UX|LC|GS|LS|LX|GX|RC|CT|SC|HS|RZ|LBX)\d/.test(cleanModel);
                }

                let isCommercialVehicle = /PROACE|DYNA|LITEACE|TOWNEACE|TUNDRA|TACOMA|LAND\s*CRUISER|CRUISER|HILUX|4RUNNER|4-RUNNER/.test(modelText);
                let isPassengerCar = !isCommercialVehicle || isLexus;

                tooltipMap.set(plateStr, {
                    systemAdvisor, leadAdvisor, finalAdvisor,
                    category: serviceResult.category, tag: serviceResult.tag,
                    isFleet: serviceResult.isFleet, kmVal: serviceResult.kmVal, calories: serviceResult.calories,
                    hasReplacementCar, isLexus, isPassengerCar, isContinuation, isEmployee: serviceResult.isEmployee,
                    isTires: serviceResult.isTires, isEV: serviceResult.isEV
                });
            }
        }

        const uniqueCarsMap = new Map();
        const blocks = xmlData.split('{id: ');

        for (let i = 1; i < blocks.length; i++) {
            const block = blocks[i];
            if (!block.includes('start: new Date')) continue;

            if (block.includes('service-schedule-employee-not-available') || block.includes('service-schedule-timeline-event-free')) {
                continue;
            }

            const groupMatch = block.match(/group:\s*"([^"]+)"/);
            if (!groupMatch) continue;
            const groupName = groupMatch[1].toUpperCase().trim();

            if (groupName.includes('SKP')) continue;

            const startMatch = block.match(/start:\s*new Date\('[^T]+T(\d{2}):(\d{2}):/);
            if (!startMatch) continue;
            const startHour = parseInt(startMatch[1], 10);
            const fullTimeStr = `${startMatch[1]}:${startMatch[2]}`;

            const titleMatch = block.match(/title(?:\\x22|")[^\>]*>([^<]+)<\\?\/span>/);
            if (titleMatch) {
                let rawPlate = titleMatch[1].trim();
                let plate = rawPlate.toUpperCase().replace(/\s+/g, '');

                let isBlacklisted = plateBlacklist.some(word => plate.includes(word));
                if (isBlacklisted) continue;

                let matchedTooltipKey = null;

                if (tooltipMap.has(plate)) {
                    matchedTooltipKey = plate;
                } else {
                    for (let key of tooltipMap.keys()) {
                        let cleanKey = key.replace(/ZGŁ\.\s*|\[|\]/g, '');
                        if (cleanKey.length > 2 && block.includes(cleanKey)) {
                            matchedTooltipKey = key;
                            break;
                        }
                    }
                }

                if (!matchedTooltipKey && plate.length === 0) {
                    continue;
                }

                let tooltipData = matchedTooltipKey ? tooltipMap.get(matchedTooltipKey) : null;
                let displayPlate = matchedTooltipKey || plate;

                if (tooltipData && !tooltipData.isPassengerCar) {
                    continue;
                }

                let tData = tooltipData || {
                    systemAdvisor: '', leadAdvisor: '', finalAdvisor: '',
                    category: 'OTHER', tag: 'I', isFleet: false, kmVal: 0, calories: 0,
                    hasReplacementCar: false, isLexus: false, isPassengerCar: true, isContinuation: false, isEmployee: false, isTires: false, isEV: false
                };

                if (uniqueCarsMap.has(displayPlate)) {
                    let existingCar = uniqueCarsMap.get(displayPlate);

                    if (!existingCar.isEmployee && !tData.isEmployee) {
                        const isNewCarInspection = (tData.category === 'DUZY_PRZEGLAD' || tData.category === 'MALY_PRZEGLAD');
                        const isExistingCarInspection = (existingCar.category === 'DUZY_PRZEGLAD' || existingCar.category === 'MALY_PRZEGLAD');

                        if (isNewCarInspection && !isExistingCarInspection) {
                            existingCar.category = tData.category;
                            existingCar.tag = tData.tag;
                            existingCar.calories = tData.calories;
                            existingCar.kmVal = tData.kmVal;
                        }
                    }

                    if (tData.isFleet) existingCar.isFleet = true;
                    if (tData.isLexus) existingCar.isLexus = true;
                    if (tData.hasReplacementCar) existingCar.hasReplacementCar = true;
                    if (tData.isTires) existingCar.isTires = true;
                    if (tData.isEV) existingCar.isEV = true;

                    if (startHour < existingCar.startHour) {
                        existingCar.startHour = startHour;
                        existingCar.timeStr = fullTimeStr;
                        existingCar.groupName = groupName;
                    }
                } else {
                    uniqueCarsMap.set(displayPlate, {
                        plate: displayPlate,
                        startHour: startHour,
                        timeStr: fullTimeStr,
                        groupName: groupName,
                        systemAdvisor: tData.systemAdvisor,
                        leadAdvisor: tData.leadAdvisor,
                        finalAdvisor: tData.finalAdvisor,
                        category: tData.category,
                        tag: tData.tag,
                        isFleet: tData.isFleet,
                        kmVal: tData.kmVal,
                        calories: tData.calories,
                        hasReplacementCar: tData.hasReplacementCar,
                        isLexus: tData.isLexus,
                        isContinuation: tData.isContinuation,
                        isEmployee: tData.isEmployee,
                        isTires: tData.isTires,
                        isEV: tData.isEV
                    });
                }
            }
        }

        let allCars = Array.from(uniqueCarsMap.values());
        const sortChronologically = (a, b) => a.timeStr.localeCompare(b.timeStr);
        allCars.sort(sortChronologically);

        allCars.forEach(car => {
            let assignedAdvisorName = car.finalAdvisor;
            let advInfo = assignedAdvisorName ? ` (${assignedAdvisorName})` : '';

            let tagHtml = getTagHTML(car.category, car.tag);
            let kontHtml = car.isContinuation ? ` <span style="color:#d35400; font-weight:bold;">[K${advInfo}]</span>` : (assignedAdvisorName ? ` <span style="color:#27ae60; font-size:11px;">${advInfo}</span>` : '');
            let zastHtml = car.hasReplacementCar ? ' <span style="color:#9c27b0; font-weight:bold;">🚘 [ZAS]</span>' : '';
            let lexHtml = car.isLexus ? ' <span style="color:#d4af37; font-weight:bold;">[L]</span>' : '';
            let evHtml = car.isEV ? ' <span style="color:#00b894; font-weight:bold;">⚡ [EV]</span>' : '';
            let calHtml = car.calories > 0 ? ` <span style="color:#7f8c8d; font-size:10px;">(${car.calories}pt)</span>` : '';
            let tiresExtraHtml = (car.isTires && car.tag !== 'O') ? ' <span style="color:#8e44ad; font-weight:bold;">[🛞]</span>' : '';

            car.display = `<b>${tagHtml} ${car.plate}</b> (${car.timeStr})${calHtml}${kontHtml}${zastHtml}${lexHtml}${evHtml}${tiresExtraHtml} <span style="color:#7f8c8d; font-size:11px;">[${car.groupName}]</span>`;

            let sGroup = shortenGroupName(car.groupName);
            let printKont = car.isContinuation ? ` [K${advInfo}]` : (assignedAdvisorName ? ` ${advInfo}` : '');
            let printZast = car.hasReplacementCar ? ' 🔑' : '';
            let printLex = car.isLexus ? ' <b style="color:#b8860b;">L</b>' : '';
            let printEV = car.isEV ? ' ⚡' : '';
            let printTires = (car.isTires && car.tag !== 'O') ? ' 🛞' : '';
            car.rawPrint = `<div class="cell-main">[${car.tag}]${printKont} ${car.plate}</div><div class="cell-sub">${car.timeStr} (${sGroup})${printZast}${printLex}${printEV}${printTires}</div>`;
        });

        if (currentMode === 'rozpiska') {
            renderScheduleResults(allCars);
        } else {
            processAndAssignPlates(allCars, advisorsConfig);
        }
    }

    function processAndAssignPlates(allCars, advisorsConfig) {
        const assignment = {};
        advisorsConfig.forEach(a => {
            a.counts = { total: 0, WERYFIKACJA: 0, MALY_PRZEGLAD: 0, DUZY_PRZEGLAD: 0, OTHER: 0 };
            a.totalCalories = 0;
            assignment[a.name] = [];
        });

        let gra1 = [];
        let gra3 = [];
        let unassigned = [];
        const categories = ['DUZY_PRZEGLAD', 'MALY_PRZEGLAD', 'WERYFIKACJA', 'OTHER'];

        // Przydzielanie sztywne (umówieni doradcy)
        allCars.forEach(car => {
            let eligible = advisorsConfig.filter(adv => isEligible(adv, car.startHour, car.category, car.isFleet, car.kmVal));
            if (car.isLexus) eligible = eligible.filter(adv => canHandleLexus(adv.name));

            let matched = eligible.filter(adv => isAdvisorMatch(adv.name, car.finalAdvisor));

            if (matched.length > 0) {
                car.isHardMatched = true;
                let adv = matched[0];
                car.display += ` <i style="color:#2ca02c; font-size:11px;">[umówione]</i>`;
                assignment[adv.name].push(car);
                adv.counts[car.category]++;
                adv.counts.total++;
                adv.totalCalories += car.calories;
            } else {
                car.isHardMatched = false;
            }
        });

        // WYLICZANIE ŚREDNIEGO LIMITU KALORYCZNOŚCI DLA PRYWATNYCH
        let privateUnassignedCars1 = allCars.filter(c => !c.isHardMatched && !c.isFleet && c.startHour < 13 && (c.category === 'DUZY_PRZEGLAD' || c.category === 'MALY_PRZEGLAD'));
        let privateUnassignedCars3 = allCars.filter(c => !c.isHardMatched && !c.isFleet && c.startHour >= 13 && (c.category === 'DUZY_PRZEGLAD' || c.category === 'MALY_PRZEGLAD'));

        let totalPrivCal1 = privateUnassignedCars1.reduce((sum, c) => sum + c.calories, 0);
        let totalPrivCal3 = privateUnassignedCars3.reduce((sum, c) => sum + c.calories, 0);

        let advShift1Count = advisorsConfig.filter(a => (a.shift === 1 || a.shift === 2 || a.shift === 4) && !a.isFleetOnly).length || 1;
        let advShift3Count = advisorsConfig.filter(a => (a.shift === 3 || a.shift === 2) && !a.isFleetOnly).length || 1;

        let caloriePrivCapShift1 = Math.round((totalPrivCal1 / advShift1Count) * 1.2) + 15;
        let caloriePrivCapShift3 = Math.round((totalPrivCal3 / advShift3Count) * 1.2) + 15;

        // DYNAMICZNE PRZYDZIELANIE: ETAP 1 - PRYWATNE, ETAP 2 - FLOTY
        const targetFleetTypes = [false, true];

        targetFleetTypes.forEach(isFleetStage => {
            categories.forEach(cat => {
                let catCars = allCars.filter(c => c.category === cat && !c.isHardMatched && c.isFleet === isFleetStage);

                catCars.sort((a, b) => b.calories - a.calories);

                let groups = {};

                catCars.forEach(car => {
                    let eligible = advisorsConfig.filter(adv => isEligible(adv, car.startHour, car.category, car.isFleet, car.kmVal));
                    if (car.isLexus) eligible = eligible.filter(adv => canHandleLexus(adv.name));

                    if (eligible.length === 0) {
                        if (car.isLexus) {
                            if (car.startHour < 13) {
                                gra1.push(car);
                            } else {
                                gra3.push(car);
                            }
                        } else {
                            unassigned.push(car);
                        }
                        return;
                    }

                    eligible.sort(() => Math.random() - 0.5);
                    let sig = eligible.map(a => a.name).join('|');
                    if(!groups[sig]) groups[sig] = { advisors: eligible, cars: [] };
                    groups[sig].cars.push(car);
                });

                for(let sig in groups) {
                    let g = groups[sig];
                    let cars = g.cars;
                    let advisors = g.advisors;

                    let i = 0;
                    while (i < cars.length) {
                        let car = cars[i];

                        advisors.sort((a, b) => {
                            if (car.isFleet) {
                                if (a.isFleetOnly && !b.isFleetOnly) return -1;
                                if (!a.isFleetOnly && b.isFleetOnly) return 1;

                                let aFleetCount = getAdvisorFleetCount(a.name, assignment);
                                let bFleetCount = getAdvisorFleetCount(b.name, assignment);
                                if (aFleetCount !== bFleetCount) return aFleetCount - bFleetCount;
                            }

                            if (cat === 'WERYFIKACJA' || cat === 'OTHER') {
                                if (a.counts[cat] !== b.counts[cat]) return a.counts[cat] - b.counts[cat];
                                if (a.counts.total !== b.counts.total) return a.counts.total - b.counts.total;
                                return a.totalCalories - b.totalCalories;
                            } else {
                                if (!car.isFleet) {
                                    let aPrivCal = getAdvisorPrivateCalories(a.name, assignment);
                                    let bPrivCal = getAdvisorPrivateCalories(b.name, assignment);
                                    if (aPrivCal !== bPrivCal) return aPrivCal - bPrivCal;
                                }
                                if (a.totalCalories !== b.totalCalories) return a.totalCalories - b.totalCalories;
                                if (a.counts.total !== b.counts.total) return a.counts.total - b.counts.total;
                            }

                            let aHourly = getHourlyCarCount(a.name, assignment, car.startHour);
                            let bHourly = getHourlyCarCount(b.name, assignment, car.startHour);
                            return aHourly - bHourly;
                        });

                        let chosen = advisors[0];

                        if (!car.isFleet && (cat === 'DUZY_PRZEGLAD' || cat === 'MALY_PRZEGLAD')) {
                            let currentPrivCap = (car.startHour < 13) ? caloriePrivCapShift1 : caloriePrivCapShift3;
                            let chosenPrivCal = getAdvisorPrivateCalories(chosen.name, assignment);

                            if (chosenPrivCal + car.calories > currentPrivCap) {
                                if (car.isLexus) {
                                    let moveableCarIdx = assignment[chosen.name].findIndex(c => !c.isHardMatched && !c.isLexus && (c.category === 'DUZY_PRZEGLAD' || c.category === 'MALY_PRZEGLAD'));

                                    if (moveableCarIdx !== -1) {
                                        let removedCar = assignment[chosen.name].splice(moveableCarIdx, 1)[0];
                                        chosen.counts[removedCar.category]--;
                                        chosen.counts.total--;
                                        chosen.totalCalories -= removedCar.calories;

                                        if (removedCar.startHour < 13) {
                                            gra1.push(removedCar);
                                        } else {
                                            gra3.push(removedCar);
                                        }
                                    }
                                } else {
                                    if (car.startHour < 13) {
                                        gra1.push(car);
                                    } else {
                                        gra3.push(car);
                                    }
                                    i++;
                                    continue;
                                }
                            }
                        }

                        assignment[chosen.name].push(car);
                        chosen.counts[cat]++;
                        chosen.counts.total++;
                        chosen.totalCalories += car.calories;
                        i++;
                    }
                }
            });
        });

        const sortChronologically = (a, b) => a.timeStr.localeCompare(b.timeStr);
        for (const name in assignment) {
            assignment[name].sort(sortChronologically);
        }
        gra1.sort(sortChronologically);
        gra3.sort(sortChronologically);
        unassigned.sort(sortChronologically);

        renderAssignmentResults(assignment, unassigned, gra1, gra3, allCars.length, advisorsConfig);
    }

    function renderScheduleResults(allCars) {
        const resultsDiv = document.getElementById('tm-results');

        const scheduleData = {
            'MALY_PRZEGLAD': { shift1: [], shift2: [], label: 'Małe Przeglądy [M]' },
            'DUZY_PRZEGLAD': { shift1: [], shift2: [], label: 'Duże Przeglądy [D]' },
            'WERYFIKACJA': { shift1: [], shift2: [], label: 'Weryfikacje [W]' },
            'OTHER': { shift1: [], shift2: [], label: 'Inne [I] / Opony [O]' }
        };

        allCars.forEach(car => {
            const cat = scheduleData[car.category] ? car.category : 'OTHER';
            if (car.startHour < 13) {
                scheduleData[cat].shift1.push(car);
            } else {
                scheduleData[cat].shift2.push(car);
            }
        });

        let dayText = selectedDayOffset === 0 ? "Dzisiaj" : "Jutro";
        let html = `<p style="font-size:12px; font-weight:bold; margin-bottom:10px;">Łącznie aut na rozpisce (${dayText}): ${allCars.length}</p>`;

        for (const key in scheduleData) {
            const cat = scheduleData[key];
            html += `<div style="margin-bottom:12px; background:#f9f9f9; padding:8px; border-radius:4px; border:1px solid #eee;">
                <div style="font-weight:bold; font-size:13px; border-bottom:1px solid #ddd; padding-bottom:4px; margin-bottom:6px; color:#2c3e50;">
                    ${cat.label} <span style="font-size:11px; color:#7f8c8d; font-weight:normal;">(Razem: ${cat.shift1.length + cat.shift2.length})</span>
                </div>`;

            html += `<div style="font-weight:bold; font-size:11px; color:#2980b9; margin-top:4px;">Zmiana 1 (6:00 - 13:00) [${cat.shift1.length}]:</div>`;
            if (cat.shift1.length === 0) {
                html += `<div style="font-size:11px; color:#95a5a6; font-style:italic;">Brak</div>`;
            } else {
                cat.shift1.forEach(c => { html += `<div style="font-size:11px; margin-bottom:2px;">${c.display}</div>`; });
            }

            html += `<div style="font-weight:bold; font-size:11px; color:#d35400; margin-top:6px;">Zmiana 2 (13:00 - 21:00) [${cat.shift2.length}]:</div>`;
            if (cat.shift2.length === 0) {
                html += `<div style="font-size:11px; color:#95a5a6; font-style:italic;">Brak</div>`;
            } else {
                cat.shift2.forEach(c => { html += `<div style="font-size:11px; margin-bottom:2px;">${c.display}</div>`; });
            }

            html += `</div>`;
        }

        html += `<button id="tm-print-schedule-btn" style="width: 100%; margin-top: 10px; padding: 8px; background: #27ae60; color: white; border: none; border-radius: 4px; font-weight: bold; font-size: 12px; cursor: pointer;">
            🖨️ Drukuj Rozpiskę
        </button>`;

        resultsDiv.innerHTML = html;

        document.getElementById('tm-print-schedule-btn').onclick = () => {
            printScheduleTable(scheduleData);
        };
    }

    function printScheduleTable(scheduleData) {
        let printWin = window.open('', '_blank');
        if (!printWin) {
            alert("Przeglądarka zablokowała okno druku!");
            return;
        }

        let d = new Date();
        d.setDate(d.getDate() + selectedDayOffset);
        let today = d.toLocaleDateString('pl-PL');

        let html = `<html><head><title>Rozpiska Aut - ${today}</title><style>
            body { font-family: Arial, sans-serif; margin: 10px; font-size: 11px; }
            h2 { text-align: center; margin-bottom: 10px; font-size: 16px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
            th, td { border: 1px solid #000; padding: 5px; text-align: center; vertical-align: top; width: 25%; }
            th { background-color: #f2f2f2; font-weight: bold; font-size: 12px; }
            .cell-main { font-weight: bold; font-size: 11px; }
            .cell-sub { font-size: 10px; color: #333; }
            .shift-header { background-color: #e9ecef; font-weight: bold; text-align: left; padding: 4px 8px; }
        </style></head><body>`;

        html += `<h2>Rozpiska Aut na Hali - ${today}</h2>`;
        html += `<table><thead><tr>
            <th>Małe Przeglądy [M]</th>
            <th>Duże Przeglądy [D]</th>
            <th>Weryfikacje [W]</th>
            <th>Inne [I] / Opony [O]</th>
        </tr></thead><tbody>`;

        html += `<tr><td colspan="4" class="shift-header">ZMIANA 1 (6:00 - 13:00)</td></tr><tr>`;
        const keys = ['MALY_PRZEGLAD', 'DUZY_PRZEGLAD', 'WERYFIKACJA', 'OTHER'];

        keys.forEach(k => {
            html += `<td>`;
            scheduleData[k].shift1.forEach(c => { html += `<div style="margin-bottom:5px;">${c.rawPrint}</div>`; });
            html += `</td>`;
        });
        html += `</tr>`;

        html += `<tr><td colspan="4" class="shift-header">ZMIANA 2 (13:00 - 21:00)</td></tr><tr>`;
        keys.forEach(k => {
            html += `<td>`;
            scheduleData[k].shift2.forEach(c => { html += `<div style="margin-bottom:5px;">${c.rawPrint}</div>`; });
            html += `</td>`;
        });
        html += `</tr>`;

        html += `</tbody></table>`;
        html += `<script>window.onload = function() { window.print(); };</script></body></html>`;

        printWin.document.write(html);
        printWin.document.close();
    }

    function renderAssignmentResults(assignment, unassigned, gra1, gra3, totalCars, advisorsConfig) {
        const resultsDiv = document.getElementById('tm-results');
        let dayText = selectedDayOffset === 0 ? "Dzisiaj" : "Jutro";
        let html = `<p style="font-size:12px; font-weight:bold; margin-bottom:10px;">Łącznie wykrytych aut (${dayText}): ${totalCars}</p>`;

        advisorsConfig.forEach(adv => {
            const cars = assignment[adv.name] || [];
            let fleetTag = adv.isFleetOnly ? ' <span style="color:#27ae60; font-size:10px;">[Flota do 75k]</span>' : '';
            html += `<div style="margin-bottom:12px; background:#f9f9f9; padding:8px; border-radius:4px; border:1px solid #eee;">
                <div style="font-weight:bold; font-size:13px; border-bottom:1px solid #ddd; padding-bottom:4px; margin-bottom:6px; color:#2c3e50;">
                    ${adv.name}${fleetTag} <span style="font-size:11px; color:#7f8c8d; font-weight:normal;">(Suma: ${adv.counts.total} aut | W:${adv.counts.WERYFIKACJA} I:${adv.counts.OTHER} | ${adv.totalCalories} pkt)</span>
                </div>`;

            if (cars.length === 0) {
                html += `<div style="font-size:11px; color:#95a5a6; font-style:italic;">Brak przydzielonych aut</div>`;
            } else {
                cars.forEach(car => {
                    html += `<div style="font-size:11px; margin-bottom:3px; line-height:1.3;">${car.display}</div>`;
                });
            }
            html += `</div>`;
        });

        if (gra1.length > 0 || gra3.length > 0) {
            html += `<div style="margin-top:10px; padding:8px; background:#fff3cd; border:1px solid #ffeeba; border-radius:4px;">
                <div style="font-weight:bold; font-size:12px; color:#856404; margin-bottom:4px;">GRA:</div>`;
            if (gra1.length > 0) {
                html += `<div style="font-size:11px; font-weight:bold; color:#856404; margin-top:2px;">Zmiana 1:</div>`;
                gra1.forEach(c => html += `<div style="font-size:11px;">${c.display}</div>`);
            }
            if (gra3.length > 0) {
                html += `<div style="font-size:11px; font-weight:bold; color:#856404; margin-top:2px;">Zmiana 3:</div>`;
                gra3.forEach(c => html += `<div style="font-size:11px;">${c.display}</div>`);
            }
            html += `</div>`;
        }

        if (unassigned.length > 0) {
            html += `<div style="margin-top:10px; padding:8px; background:#f8d7da; border:1px solid #f5c6cb; border-radius:4px;">
                <div style="font-weight:bold; font-size:12px; color:#721c24; margin-bottom:4px;">Nieprzydzielone:</div>`;
            unassigned.forEach(c => html += `<div style="font-size:11px;">${c.display}</div>`);
            html += `</div>`;
        }

        html += `<div style="display:flex; gap:5px; margin-top:10px;">
            <button id="tm-print-btn" style="flex:1; padding: 8px; background: #27ae60; color: white; border: none; border-radius: 4px; font-weight: bold; font-size: 11px; cursor: pointer;">
                🖨️ Drukuj Podział
            </button>
            <button id="tm-download-btn" style="flex:1; padding: 8px; background: #2980b9; color: white; border: none; border-radius: 4px; font-weight: bold; font-size: 11px; cursor: pointer;" title="Zapisuje plik HTML do udostępnienia na dysku sieciowym">
                💾 Zapisz plik HTML
            </button>
        </div>`;

        resultsDiv.innerHTML = html;

        document.getElementById('tm-print-btn').onclick = () => {
            printAssignmentTable(assignment, gra1, gra3, advisorsConfig);
        };

        document.getElementById('tm-download-btn').onclick = () => {
            downloadAssignmentHTML(assignment, gra1, gra3, advisorsConfig);
        };
    }

    function printAssignmentTable(assignment, gra1, gra3, advisorsConfig) {
        let printWin = window.open('', '_blank');
        if (!printWin) {
            alert("Przeglądarka zablokowała okno druku!");
            return;
        }

        let d = new Date();
        d.setDate(d.getDate() + selectedDayOffset);
        let today = d.toLocaleDateString('pl-PL');

        let morningAdvisors = advisorsConfig.filter(a => a.shift === 1 || a.shift === 2 || a.shift === 4);
        let afternoonAdvisors = advisorsConfig.filter(a => a.shift === 3 || a.shift === 2);

        let html = `<html><head><title>Podział Aut - ${today}</title><style>
            body { font-family: Arial, sans-serif; margin: 10px; font-size: 11px; }
            h2 { text-align: center; margin-bottom: 5px; font-size: 16px; }
            h3 { text-align: left; margin-top: 10px; margin-bottom: 5px; font-size: 13px; color: #2c3e50; border-bottom: 2px solid #2c3e50; padding-bottom: 3px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
            th, td { border: 1px solid #000; padding: 4px; text-align: center; vertical-align: top; }
            th { background-color: #f2f2f2; font-weight: bold; font-size: 11px; }
            .cell-main { font-weight: bold; font-size: 11px; }
            .cell-sub { font-size: 10px; color: #333; }
            .gra-header { background-color: #fff3cd; font-weight: bold; text-align: left; padding: 4px; font-size: 11px; }
            .page-break { page-break-before: always; margin-top: 20px; }
        </style></head><body>`;

        html += `<h2>Podział Aut Doradców - ${today}</h2>`;

        // --- SEKCJA 1: ZMIANA I (RANO) ---
        html += `<h3>ZMIANA I (6:00 - 13:00)</h3>`;
        if (morningAdvisors.length > 0) {
            html += `<table><thead><tr>`;
            morningAdvisors.forEach(adv => {
                let cars = (assignment[adv.name] || []).filter(c => c.startHour < 13);
                let fleetLbl = adv.isFleetOnly ? ' (Flota)' : '';
                html += `<th>${adv.name}${fleetLbl}<br><span style="font-weight:normal; font-size:10px;">(${cars.length} aut)</span></th>`;
            });
            html += `</tr></thead><tbody>`;

            let maxMorningRows = 0;
            morningAdvisors.forEach(adv => {
                let len = (assignment[adv.name] || []).filter(c => c.startHour < 13).length;
                if (len > maxMorningRows) maxMorningRows = len;
            });

            for (let r = 0; r < maxMorningRows; r++) {
                html += `<tr>`;
                morningAdvisors.forEach(adv => {
                    let cars = (assignment[adv.name] || []).filter(c => c.startHour < 13);
                    let car = cars[r];
                    html += `<td>${car ? car.rawPrint : ''}</td>`;
                });
                html += `</tr>`;
            }
            html += `</tbody></table>`;
        } else {
            html += `<p style="font-style:italic; font-size:10px; color:#777;">Brak doradców na tej zmianie</p>`;
        }

        if (gra1.length > 0) {
            html += `<div style="margin-bottom:15px; border:1px solid #000; padding:4px; background:#fff3cd;">
                <div class="gra-header">GRA - Zmiana 1 (&lt; 13:00) [${gra1.length} aut]:</div>
                <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:4px;">`;
            gra1.forEach(c => { html += `<div style="border:1px dashed #666; padding:3px; background:#fff;">${c.rawPrint}</div>`; });
            html += `</div></div>`;
        }

        // --- SEKCJA 2: ZMIANA III (POPOŁUDNIE - OSOBNA KARTKA) ---
        html += `<div class="page-break"></div>`;
        html += `<h3>ZMIANA III (13:00 - 21:00)</h3>`;
        if (afternoonAdvisors.length > 0) {
            html += `<table><thead><tr>`;
            afternoonAdvisors.forEach(adv => {
                let cars = (assignment[adv.name] || []).filter(c => c.startHour >= 13);
                let fleetLbl = adv.isFleetOnly ? ' (Flota)' : '';
                html += `<th>${adv.name}${fleetLbl}<br><span style="font-weight:normal; font-size:10px;">(${cars.length} aut)</span></th>`;
            });
            html += `</tr></thead><tbody>`;

            let maxAfternoonRows = 0;
            afternoonAdvisors.forEach(adv => {
                let len = (assignment[adv.name] || []).filter(c => c.startHour >= 13).length;
                if (len > maxAfternoonRows) maxAfternoonRows = len;
            });

            for (let r = 0; r < maxAfternoonRows; r++) {
                html += `<tr>`;
                afternoonAdvisors.forEach(adv => {
                    let cars = (assignment[adv.name] || []).filter(c => c.startHour >= 13);
                    let car = cars[r];
                    html += `<td>${car ? car.rawPrint : ''}</td>`;
                });
                html += `</tr>`;
            }
            html += `</tbody></table>`;
        } else {
            html += `<p style="font-style:italic; font-size:10px; color:#777;">Brak doradców na tej zmianie</p>`;
        }

        if (gra3.length > 0) {
            html += `<div style="margin-bottom:15px; border:1px solid #000; padding:4px; background:#fff3cd;">
                <div class="gra-header">GRA - Zmiana 3 (13:00+) [${gra3.length} aut]:</div>
                <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:4px;">`;
            gra3.forEach(c => { html += `<div style="border:1px dashed #666; padding:3px; background:#fff;">${c.rawPrint}</div>`; });
            html += `</div></div>`;
        }

        html += `<script>window.onload = function() { window.print(); };</script></body></html>`;

        printWin.document.write(html);
        printWin.document.close();
    }

    function downloadAssignmentHTML(assignment, gra1, gra3, advisorsConfig) {
        let d = new Date();
        d.setDate(d.getDate() + selectedDayOffset);
        let today = d.toLocaleDateString('pl-PL');
        let filename = `Podzial_Aut_${today.replace(/\./g, '-')}.html`;

        let morningAdvisors = advisorsConfig.filter(a => a.shift === 1 || a.shift === 2 || a.shift === 4);
        let afternoonAdvisors = advisorsConfig.filter(a => a.shift === 3 || a.shift === 2);

        let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Podział Aut - ${today}</title><style>
            body { font-family: Arial, sans-serif; margin: 15px; font-size: 11px; background-color: #f4f6f7; }
            .container { max-width: 1200px; margin: 0 auto; background: #fff; padding: 15px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
            h2 { text-align: center; margin-bottom: 10px; font-size: 18px; color: #2c3e50; }
            h3 { text-align: left; margin-top: 20px; margin-bottom: 8px; font-size: 14px; color: #2c3e50; border-bottom: 2px solid #2c3e50; padding-bottom: 4px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
            th, td { border: 1px solid #ccc; padding: 6px; text-align: center; vertical-align: top; }
            th { background-color: #eef2f3; font-weight: bold; font-size: 12px; }
            .cell-main { font-weight: bold; font-size: 11px; color: #000; }
            .cell-sub { font-size: 10px; color: #555; margin-top: 2px; }
            .gra-box { margin-bottom: 15px; border: 1px solid #ffeeba; padding: 8px; background: #fff3cd; border-radius: 4px; }
            .gra-header { font-weight: bold; color: #856404; font-size: 12px; margin-bottom: 5px; }
            .search-info { background: #e3f2fd; color: #0d47a1; padding: 8px; border-radius: 4px; text-align: center; margin-bottom: 15px; font-weight: bold; }
        </style></head><body><div class="container">`;

        html += `<h2>Podział Aut Doradców - ${today}</h2>`;
        html += `<div class="search-info">🔍 Naciśnij <u>Ctrl + F</u>, aby wyszukać numer rejestracyjny lub nazwisko!</div>`;

        // ZMIANA 1
        html += `<h3>ZMIANA I (6:00 - 13:00)</h3>`;
        if (morningAdvisors.length > 0) {
            html += `<table><thead><tr>`;
            morningAdvisors.forEach(adv => {
                let cars = (assignment[adv.name] || []).filter(c => c.startHour < 13);
                let fleetLbl = adv.isFleetOnly ? ' (Flota)' : '';
                html += `<th>${adv.name}${fleetLbl}<br><span style="font-weight:normal; font-size:10px;">(${cars.length} aut)</span></th>`;
            });
            html += `</tr></thead><tbody>`;

            let maxRows = Math.max(...morningAdvisors.map(adv => (assignment[adv.name] || []).filter(c => c.startHour < 13).length), 0);
            for (let r = 0; r < maxRows; r++) {
                html += `<tr>`;
                morningAdvisors.forEach(adv => {
                    let cars = (assignment[adv.name] || []).filter(c => c.startHour < 13);
                    let car = cars[r];
                    html += `<td>${car ? car.rawPrint : ''}</td>`;
                });
                html += `</tr>`;
            }
            html += `</tbody></table>`;
        }

        if (gra1.length > 0) {
            html += `<div class="gra-box"><div class="gra-header">GRA - Zmiana 1 (&lt; 13:00) [${gra1.length} aut]:</div><div style="display:flex; flex-wrap:wrap; gap:8px;">`;
            gra1.forEach(c => { html += `<div style="border:1px dashed #999; padding:4px; background:#fff; border-radius:3px;">${c.rawPrint}</div>`; });
            html += `</div></div>`;
        }

        // ZMIANA 3
        html += `<h3>ZMIANA III (13:00 - 21:00)</h3>`;
        if (afternoonAdvisors.length > 0) {
            html += `<table><thead><tr>`;
            afternoonAdvisors.forEach(adv => {
                let cars = (assignment[adv.name] || []).filter(c => c.startHour >= 13);
                let fleetLbl = adv.isFleetOnly ? ' (Flota)' : '';
                html += `<th>${adv.name}${fleetLbl}<br><span style="font-weight:normal; font-size:10px;">(${cars.length} aut)</span></th>`;
            });
            html += `</tr></thead><tbody>`;

            let maxRows = Math.max(...afternoonAdvisors.map(adv => (assignment[adv.name] || []).filter(c => c.startHour >= 13).length), 0);
            for (let r = 0; r < maxRows; r++) {
                html += `<tr>`;
                afternoonAdvisors.forEach(adv => {
                    let cars = (assignment[adv.name] || []).filter(c => c.startHour >= 13);
                    let car = cars[r];
                    html += `<td>${car ? car.rawPrint : ''}</td>`;
                });
                html += `</tr>`;
            }
            html += `</tbody></table>`;
        }

        if (gra3.length > 0) {
            html += `<div class="gra-box"><div class="gra-header">GRA - Zmiana 3 (13:00+) [${gra3.length} aut]:</div><div style="display:flex; flex-wrap:wrap; gap:8px;">`;
            gra3.forEach(c => { html += `<div style="border:1px dashed #999; padding:4px; background:#fff; border-radius:3px;">${c.rawPrint}</div>`; });
            html += `</div></div>`;
        }

        html += `</div></body></html>`;

        let blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
        let link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
    }

    function createUI() {
        const btn = document.createElement('button');
        btn.innerHTML = '🚗';
        btn.style.position = 'fixed';
        btn.style.bottom = '20px';
        btn.style.right = '20px';
        btn.style.width = '45px';
        btn.style.height = '45px';
        btn.style.borderRadius = '50%';
        btn.style.backgroundColor = '#cc0000';
        btn.style.color = 'white';
        btn.style.border = 'none';
        btn.style.fontSize = '20px';
        btn.style.cursor = 'pointer';
        btn.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
        btn.style.zIndex = '10000';
        btn.style.display = 'flex';
        btn.style.alignItems = 'center';
        btn.style.justifyContent = 'center';
        btn.title = "Panel podziału aut";

        const modal = document.createElement('div');
        modal.id = 'tm-modal';
        modal.style.position = 'fixed';
        modal.style.bottom = '75px';
        modal.style.right = '20px';
        modal.style.width = '370px';
        modal.style.maxHeight = '85vh';
        modal.style.overflowY = 'auto';
        modal.style.backgroundColor = '#ffffff';
        modal.style.border = '1px solid #d1d1d1';
        modal.style.borderRadius = '8px';
        modal.style.boxShadow = '0 6px 12px rgba(0,0,0,0.2)';
        modal.style.padding = '15px';
        modal.style.zIndex = '9999';
        modal.style.display = 'none';
        modal.style.fontFamily = 'Segoe UI, Arial, sans-serif';

        modal.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 8px;">
                <h3 style="margin: 0; font-size: 15px; color: #333;">System Kanri Auto-Podział</h3>
                <span id="tm-close-modal" style="cursor: pointer; color: #888; font-weight: bold; font-size: 16px;">✕</span>
            </div>

            <!-- Zakładki Wyboru Dnia -->
            <div style="display:flex; gap:5px; margin-bottom:8px;">
                <button id="tm-day-today" style="flex:1; padding:5px; background:#2c3e50; color:white; border:none; border-radius:4px; font-weight:bold; font-size:11px; cursor:pointer;">
                    📅 Dzisiaj
                </button>
                <button id="tm-day-tomorrow" style="flex:1; padding:5px; background:#bdc3c7; color:#333; border:none; border-radius:4px; font-weight:bold; font-size:11px; cursor:pointer;">
                    📅 Jutro
                </button>
            </div>

            <!-- Zakładki Trybów -->
            <div style="display:flex; gap:5px; margin-bottom:12px;">
                <button id="tm-tab-podzial" style="flex:1; padding:6px; background:#cc0000; color:white; border:none; border-radius:4px; font-weight:bold; font-size:12px; cursor:pointer;">
                    Podział Doradców
                </button>
                <button id="tm-tab-rozpiska" style="flex:1; padding:6px; background:#e0e0e0; color:#333; border:none; border-radius:4px; font-weight:bold; font-size:12px; cursor:pointer;">
                    Rozpiska Usług
                </button>
            </div>

            <div id="tm-advisors-section">
                <div id="tm-advisors-list" style="margin-bottom: 10px;"></div>
                <button id="tm-add-adv-btn" style="width: 100%; margin-bottom: 12px; padding: 6px; background: #f4f4f4; color: #555; border: 1px solid #ccc; border-radius: 4px; font-size: 12px; cursor: pointer;">
                    + Dodaj doradcę
                </button>
            </div>

            <button id="tm-fetch-btn" style="width: 100%; padding: 10px; background: #cc0000; color: white; border: none; border-radius: 4px; font-weight: bold; font-size: 13px; cursor: pointer;">
                Pobierz i Generuj
            </button>

            <div id="tm-results" style="margin-top: 15px;"></div>
        `;

        document.body.appendChild(btn);
        document.body.appendChild(modal);

        const listContainer = document.getElementById('tm-advisors-list');
        const advSection = document.getElementById('tm-advisors-section');
        const tabPodzial = document.getElementById('tm-tab-podzial');
        const tabRozpiska = document.getElementById('tm-tab-rozpiska');

        const dayToday = document.getElementById('tm-day-today');
        const dayTomorrow = document.getElementById('tm-day-tomorrow');

        function addAdvisorRow(defaultName = '', defaultShift = 1, defaultFleet = false) {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.gap = '5px';
            row.style.alignItems = 'center';
            row.style.marginBottom = '5px';
            row.className = 'tm-adv-row';

            row.innerHTML = `
                <input type="text" class="tm-adv-name" placeholder="np. Mikołaj Falkowski" value="${defaultName}" style="flex: 1; min-width: 0; padding: 5px; font-size: 12px; border: 1px solid #ccc; border-radius: 4px;">
                <select class="tm-adv-shift" style="width: 100px; padding: 5px; font-size: 12px; border: 1px solid #ccc; border-radius: 4px;">
                    <option value="1" ${defaultShift === 1 ? 'selected' : ''}>Zm. 1 (&lt; 13:00)</option>
                    <option value="2" ${defaultShift === 2 ? 'selected' : ''}>Zm. 2 (9-14)</option>
                    <option value="3" ${defaultShift === 3 ? 'selected' : ''}>Zm. 3 (13-21)</option>
                    <option value="4" ${defaultShift === 4 ? 'selected' : ''}>Sobota (7-15)</option>
                </select>
                <label style="font-size: 10px; display: flex; align-items: center; gap: 2px; cursor: pointer; user-select: none;" title="Uczący się: przyjmuje tylko przeglądy flotowe/KINTO do 75kkm oraz inne usługi po równo">
                    <input type="checkbox" class="tm-adv-fleet" ${defaultFleet ? 'checked' : ''}> Flota
                </label>
                <button class="tm-adv-remove" style="background: transparent; color: red; border: none; font-weight: bold; cursor: pointer; padding: 0 3px;">✕</button>
            `;

            row.querySelector('.tm-adv-remove').onclick = () => row.remove();
            listContainer.appendChild(row);
        }

        addAdvisorRow('Jakub Leczycki', 1, false);
        addAdvisorRow('Norbert L', 2, false);

        document.getElementById('tm-add-adv-btn').onclick = () => addAdvisorRow();

        dayToday.onclick = () => {
            selectedDayOffset = 0;
            dayToday.style.background = '#2c3e50';
            dayToday.style.color = 'white';
            dayTomorrow.style.background = '#bdc3c7';
            dayTomorrow.style.color = '#333';
        };

        dayTomorrow.onclick = () => {
            selectedDayOffset = 1;
            dayTomorrow.style.background = '#2c3e50';
            dayTomorrow.style.color = 'white';
            dayToday.style.background = '#bdc3c7';
            dayToday.style.color = '#333';
        };

        tabPodzial.onclick = () => {
            currentMode = 'podzial';
            tabPodzial.style.background = '#cc0000';
            tabPodzial.style.color = 'white';
            tabRozpiska.style.background = '#e0e0e0';
            tabRozpiska.style.color = '#333';
            advSection.style.display = 'block';
        };

        tabRozpiska.onclick = () => {
            currentMode = 'rozpiska';
            tabRozpiska.style.background = '#cc0000';
            tabRozpiska.style.color = 'white';
            tabPodzial.style.background = '#e0e0e0';
            tabPodzial.style.color = '#333';
            advSection.style.display = 'none';
        };

        btn.onclick = () => {
            modal.style.display = modal.style.display === 'none' ? 'block' : 'none';
        };

        document.getElementById('tm-close-modal').onclick = () => {
            modal.style.display = 'none';
        };

        const fetchBtn = document.getElementById('tm-fetch-btn');

        fetchBtn.onclick = async () => {
            let advisorsConfig = [];

            if (currentMode === 'podzial') {
                const rows = document.querySelectorAll('.tm-adv-row');
                rows.forEach(row => {
                    const name = row.querySelector('.tm-adv-name').value.trim();
                    const shift = parseInt(row.querySelector('.tm-adv-shift').value, 10);
                    const isFleetOnly = row.querySelector('.tm-adv-fleet').checked;
                    if (name) advisorsConfig.push({ name, shift, isFleetOnly });
                });

                if (advisorsConfig.length === 0) {
                    alert("Musisz dodać i nazwać przynajmniej jednego doradcę w tym trybie!");
                    return;
                }
            }

            fetchBtn.innerText = 'Przetwarzanie...';
            document.getElementById('tm-results').innerHTML = '';
            await fetchVehiclePlates(advisorsConfig);
            fetchBtn.innerText = 'Pobierz i Generuj';
        };
    }

    window.addEventListener('load', createUI);

})();
