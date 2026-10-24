/* =========================================================
   TERRABYTE | SISTEMA FERROVIARIO EXPERIMENTAL
   Modulo isolado: nao le nem altera nada da simulacao da turbina.
   Unica interface publica: window.TerraByteRailway
   
   ORIGEM DE CADA VALOR (nao ha fator de escala escondido):
   1. DADO FISICO CONHECIDO  - trem e medida aproximada do circuito
   2. ESTIMATIVA             - velocidade do trem fisico (1 a 2 km/h)
   3. DERIVADO               - calculado a partir de 1 e 2
   4. PARAMETRO VISUAL       - so afeta o desenho, nunca o movimento
   ========================================================= */

"use strict";

(() => {
    /* ---------- 1. DADO FISICO CONHECIDO ---------- */

    const TRAIN_MODEL = "Expresso de Hogwarts (Candide)";
    const TRACK_BOUNDING_BOX_CM = 68; // circuito fisico: aprox. 68 x 68 cm

    /* ---------- 2. ESTIMATIVAS ---------- */

    const PASSENGER_SPEED_MIN_KMH = 1.0;
    const PASSENGER_SPEED_REFERENCE_KMH = 1.5;
    const PASSENGER_SPEED_MAX_KMH = 2.0;

    /* ---------- 3. VALORES DERIVADOS ---------- */

    const TRACK_DIAMETER_METERS = TRACK_BOUNDING_BOX_CM / 100; // 0,68 m

    // APROXIMACAO GEOMETRICA: o circuito real e tratado como circulo de 0,68 m.
    // Nao e uma medicao do perimetro; o desenho SVG nao e um circulo perfeito.
    const TRACK_CIRCUMFERENCE_METERS = Math.PI * TRACK_DIAMETER_METERS; // ~2,136 m

    const kmhToMs = kmh => kmh / 3.6;
    const PASSENGER_SPEED_REFERENCE_MS = kmhToMs(PASSENGER_SPEED_REFERENCE_KMH); // ~0,4167 m/s

    // Tempo de volta (s) = comprimento (m) / velocidade (m/s).
    const lapSecondsAt = kmh => TRACK_CIRCUMFERENCE_METERS / kmhToMs(kmh);

    /* ---------- 4. PARAMETROS PUREMENTE VISUAIS ---------- */

    // Limite de deltaTime por quadro: evita "teletransporte" ao voltar de outra aba.
    // A 1,5 km/h, 0,1 s equivale a ~4 cm de percurso fisico.
    const MAX_FRAME_DELTA_SECONDS = 0.1;

    // Espaco entre unidades do trem, em unidades do SVG (o comprimento de cada
    // unidade vem de data-length no HTML).
    const TRAIN_COUPLING_GAP_UNITS = 5;

    // Distancia (unidades do SVG) usada para estimar a tangente do trilho.
    const TANGENT_SAMPLE_UNITS = 3;

    // Posicao inicial do Expresso na planta (locomotiva a leste do circuito, ~25% do
    // desenho) e sentido de marcha (-1 = anti-horario, como na foto: vagoes atras,
    // abaixo da locomotiva). Nao altera velocidade nem distancia fisica.
    const TRAIN_START_PROGRESS = 0.25;
    const PASSENGER_DIRECTION = -1;

    /* ---------- ESTADO ---------- */

    const state = {
        running: false,
        started: false,
        previousTimestamp: null,
        animationFrame: null,
        elapsedSeconds: 0,
        distanceMeters: 0,
        speedKmh: PASSENGER_SPEED_REFERENCE_KMH
    };

    const dom = {
        ready: false,
        bound: false,
        section: null,
        passengerPath: null,
        servicePath: null,
        trainGroup: null,
        cars: [],
        parked: [],
        startButton: null,
        pauseButton: null,
        continueButton: null,
        resetButton: null,
        status: null,
        speedValue: null,
        circuitLength: null,
        lapTime: null,
        distance: null,
        laps: null
    };

    let passengerPathLength = 0;

    /* ---------- FORMATACAO ---------- */

    function formatNumber(value, decimals) {
        return new Intl.NumberFormat("pt-BR", {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        }).format(value);
    }

    function setText(element, value) {
        if (element) element.textContent = value;
    }

    function wrap(value, length) {
        return ((value % length) + length) % length;
    }

    /* ---------- GEOMETRIA ---------- */

    function trackLapProgress() {
        // Progresso 0..1 no circuito, a partir da distancia FISICA percorrida.
        return wrap(state.distanceMeters, TRACK_CIRCUMFERENCE_METERS) / TRACK_CIRCUMFERENCE_METERS;
    }

    function placeOnPath(path, element, lengthAlongPath, flip = false) {
        const total = path.getTotalLength();
        const s = wrap(lengthAlongPath, total);
        const point = path.getPointAtLength(s);
        const before = path.getPointAtLength(wrap(s - TANGENT_SAMPLE_UNITS, total));
        const after = path.getPointAtLength(wrap(s + TANGENT_SAMPLE_UNITS, total));
        const angle = Math.atan2(after.y - before.y, after.x - before.x) * 180 / Math.PI + (flip ? 180 : 0);

        element.setAttribute(
            "transform",
            `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) rotate(${angle.toFixed(2)})`
        );
    }

    function placeTrain() {
        if (!dom.ready) return;

        // A locomotiva e a referencia; cada unidade fica no seu proprio ponto do
        // trilho, acompanhando a curva (articulado), e nao um bloco rigido.
        const headLength = wrap(
            (TRAIN_START_PROGRESS + PASSENGER_DIRECTION * trackLapProgress()) * passengerPathLength,
            passengerPathLength
        );

        dom.cars.forEach(car => {
            placeOnPath(
                dom.passengerPath, car.element,
                headLength - PASSENGER_DIRECTION * car.offsetUnits,
                PASSENGER_DIRECTION < 0
            );
        });
    }

    function buildCars(trainGroup) {
        const elements = Array.from(trainGroup.querySelectorAll("[data-train-car]"));
        const cars = [];
        let cursor = 0; // distancia do centro da locomotiva ate o centro desta unidade

        elements.forEach((element, index) => {
            const length = Number(element.getAttribute("data-length")) || 0;

            if (index === 0) {
                cursor = 0;
                cars.push({ element, length, offsetUnits: 0 });
                return;
            }

            const previous = cars[index - 1];
            cursor += previous.length / 2 + TRAIN_COUPLING_GAP_UNITS + length / 2;
            cars.push({ element, length, offsetUnits: cursor });
        });

        return cars;
    }

    function placeParkedUnits() {
        // Decoracao estatica sobre a ferrovia amarela (nao e um trem funcional).
        if (!dom.servicePath) return;

        const total = dom.servicePath.getTotalLength();

        dom.parked.forEach(element => {
            const fraction = Number(element.getAttribute("data-service-progress")) || 0;
            placeOnPath(dom.servicePath, element, fraction * total);
        });
    }

    /* ---------- INTERFACE ---------- */

    function currentLapSeconds() {
        return lapSecondsAt(state.speedKmh);
    }

    function render() {
        if (!dom.ready) return;

        setText(dom.speedValue, `${formatNumber(state.speedKmh, 1)} km/h`);
        setText(dom.circuitLength, `${formatNumber(TRACK_CIRCUMFERENCE_METERS, 3)} m`);
        setText(dom.lapTime, `${formatNumber(currentLapSeconds(), 2)} s`);
        setText(dom.distance, `${formatNumber(state.distanceMeters, 2)} m`);
        setText(
            dom.laps,
            String(Math.floor(state.distanceMeters / TRACK_CIRCUMFERENCE_METERS))
        );

        placeTrain();
    }

    function syncControls() {
        if (!dom.ready) return;

        dom.startButton.disabled = state.started;
        dom.pauseButton.disabled = !state.running;
        dom.continueButton.disabled = !(state.started && !state.running);
        dom.section.classList.toggle("is-paused", state.started && !state.running);
        document.getElementById("turbine")?.classList.toggle("cycle-paused", state.started && !state.running);

        if (dom.status) {
            let key = "stopped";
            let label = "TREM PARADO";

            if (state.running) {
                key = "running";
                label = "TREM EM MOVIMENTO";
            } else if (state.started) {
                key = "paused";
                label = "TREM PAUSADO";
            }

            dom.status.dataset.state = key;
            dom.status.textContent = label;
        }
    }

    /* ---------- MOVIMENTO ---------- */

    // Avanca a simulacao em deltaSeconds (so se estiver em movimento).
    // distancia = velocidade x tempo, com velocidade em m/s.
    function update(deltaSeconds) {
        if (!state.running) return;

        const delta = Math.min(
            Math.max(0, Number(deltaSeconds) || 0),
            MAX_FRAME_DELTA_SECONDS
        );

        state.elapsedSeconds += delta;
        state.distanceMeters += kmhToMs(state.speedKmh) * delta;

        fleetStep(delta);
        render();
    }

    function frame(timestamp) {
        if (!state.running) {
            state.animationFrame = null;
            return;
        }

        if (state.previousTimestamp !== null) {
            update((timestamp - state.previousTimestamp) / 1000);
        }

        state.previousTimestamp = timestamp;
        state.animationFrame = requestAnimationFrame(frame);
    }

    function cancelFrame() {
        if (state.animationFrame !== null) {
            cancelAnimationFrame(state.animationFrame);
            state.animationFrame = null;
        }

        state.previousTimestamp = null;
    }

    /* ---------- 5. FROTA E CICLO INDUSTRIAL ----------
       Camada acoplada ao modulo: usa os mesmos caminhos SVG, o mesmo laco de
       animacao (update) e o mesmo reset. NAO altera a fisica do trem de
       passageiros nem a simulacao da turbina (script.js).
       Velocidades dos demais veiculos sao PARAMETROS VISUAIS (nao medidos). */

    const SVG_NS = "http://www.w3.org/2000/svg";
    const VISUAL_SPEED = 150;          // unidades SVG/s (visual)
    const AIR_SPEED = 230;             // Harold (visual)
    const RING = { cx: 500, cy: 500, r: 135 };      // laco amarelo ao redor da area verde
    const TURBINE_PAD = { x: 700, y: 365, r: 62 };  // regiao da turbina (cenario)
    const POND = { x: 805, y: 222 };                // area azul / agua
    const RAMP_BASE = { x: 790, y: 893 };
    const RAMP_CROSS = { x: 675, y: 780 };          // onde a rampa cruza o circuito preto

    // Posicao (numeracao da planta) e identidade (catalogo oficial). Nada aqui e inventado.
    const CATALOG = [
        { id: "thomas", name: "Thomas", num: "Nº 1", tb: "TB-VEH-001", code: "J06A", photo: "1", kind: "loco", label: "Thomas", c: "#2f86d4", c2: "#1b5a9a", x: 771, y: 161, a: 40, rail: true, ring: 40, turb: 210, func: "Transporte ferroviário" },
        { id: "diesel", name: "Diesel", num: "Nº 10", tb: "TB-VEH-010", code: "F4DA", photo: "4 (inferior)", kind: "loco", label: "Diesel", c: "#2a2a30", c2: "#b3261e", x: 118, y: 868, a: -55, rail: true, ring: 330, func: "Locomotiva de logística" },
        { id: "byron", name: "Byron", num: "Nº 18", tb: "TB-VEH-018", code: "329 8 SR00", photo: "2", kind: "dozer", label: "Byron", c: "#f3c81f", c2: "#3a3a40", x: 430, y: 212, a: 10, ring: 340, turb: 120, func: "Preparação do terreno" },
        { id: "george", name: "George", num: "", tb: "TB-VEH-019", code: "326 SR00", photo: "9", kind: "roller", label: "George", c: "#4cae5b", c2: "#2f7a3c", x: 170, y: 78, a: 0, ring: 300, turb: 30, func: "Compactação e pavimentação" },
        { id: "kevin", name: "Kevin, Sodor Works", num: "", tb: "TB-VEH-020", code: "Sodor Works R9038", photo: "4 (superior)", kind: "crane", label: "Kevin", c: "#e8b21d", c2: "#a37a0c", x: 215, y: 132, a: 0, ring: 260, turb: 340, func: "Organização de suprimentos" },
        { id: "winston", name: "Winston", num: "", tb: "TB-VEH-022", code: "H29A", photo: "8", kind: "car", label: "Winston", c: "#d33a2e", c2: "#ffffff", x: 419, y: 818, a: 0, func: "Inspeção terrestre" },
        { id: "jack13", name: "Jack, 2013", num: "Nº 11", tb: "TB-VEH-023", code: "119 9 SR00", photo: "5", kind: "loader", label: "Jack 11 (2013)", c: "#c93a2e", c2: "#2a2a30", x: 713, y: 610, a: 90, ring: 154, turb: 200, func: "Movimentação de cascalho" },
        { id: "jack16", name: "Jack, 2016", num: "Nº 11", tb: "TB-VEH-024", code: "J47A", photo: "6", kind: "loader", label: "Jack 11 (2016)", c: "#d9463a", c2: "#2a2a30", x: 880, y: 673, a: 90, ring: 198, turb: 288, func: "Movimentação de cascalho" },
        { id: "henry", name: "Henry", num: "Nº 3", tb: "TB-VEH-025", code: "G05A", photo: "3", kind: "loco", label: "Henry", c: "#2e9a52", c2: "#1f6e3a", x: 760, y: 404, a: 100, ring: 20, turb: 245, func: "Transporte pesado" },
        { id: "harold", name: "Harold", num: "", tb: "TB-VEH-026", code: "H15A", photo: "10", kind: "heli", label: "Harold", c: "#f4f4f4", c2: "#c93a2e", x: 500, y: 500, a: 24, func: "Inspeção aérea" },
        { id: "hogwarts", name: "Expresso Hogwarts", num: "", tb: "TB-VEH-027", code: "Candide 37000", photo: "11", kind: null, func: "Composição ferroviária especial (trem de passageiros)" }
    ];

    const fleet = {};
    const cyc = { i: -1, t: 0, n: 0 };
    const ripples = { cool: 0, pool: [] };
    const fx = { built: false, verdict: null, stageLabel: null, cycleNumber: null, turbine: null, mainTurbine: null };

    const A2R = Math.PI / 180;
    const ringPt = (deg, r = RING.r) => ({ x: RING.cx + r * Math.cos(deg * A2R), y: RING.cy + r * Math.sin(deg * A2R) });

    function vehicleMarkup(s) {
        const c = s.c, k = s.c2, d = "#26262b";
        switch (s.kind) {
            case "loco": return `<rect x="-20" y="-8" width="40" height="16" rx="4" fill="${c}"/><rect x="-20" y="-8" width="13" height="16" rx="3" fill="${k}"/><rect x="-5" y="-6" width="20" height="12" rx="2.5" fill="${d}"/><rect x="-14" y="-10" width="9" height="3" fill="#d9dfe4"/><rect x="-1" y="-10" width="9" height="3" fill="#d9dfe4"/>`;
            case "dozer": return `<rect x="-18" y="-11" width="34" height="5" rx="2" fill="${k}"/><rect x="-18" y="6" width="34" height="5" rx="2" fill="${k}"/><rect x="-14" y="-7" width="26" height="14" rx="3" fill="${c}"/><circle cx="-8" cy="0" r="2.6" fill="#d6d6d6"/><circle cx="8" cy="0" r="2.6" fill="#d6d6d6"/>`;
            case "roller": return `<rect x="-24" y="-9" width="8" height="18" rx="3" fill="#8c969a"/><rect x="-20" y="-7" width="26" height="14" rx="3" fill="${c}"/><rect x="-16" y="-5" width="10" height="10" rx="2" fill="#dfe9ee"/><rect x="10" y="-6" width="6" height="12" rx="2" fill="#2d3a40"/>`;
            case "loader": return `<rect x="-16" y="-9" width="6" height="4" fill="${k}"/><rect x="-16" y="5" width="6" height="4" fill="${k}"/><rect x="2" y="-9" width="6" height="4" fill="${k}"/><rect x="2" y="5" width="6" height="4" fill="${k}"/><rect x="-10" y="-5" width="22" height="10" rx="3" fill="${c}"/><rect x="-2" y="-12" width="4" height="8" fill="${k}"/><rect x="-10" y="-5" width="3" height="10" fill="${k}"/>`;
            case "crane": return `<rect x="-16" y="-9" width="30" height="18" rx="3" fill="${c}"/><rect x="-13" y="-6" width="11" height="12" rx="2" fill="${k}"/><g class="rw-arm"><rect x="0" y="-2" width="18" height="4" rx="2" fill="#f7d57b"/><rect x="14" y="-2" width="4" height="4" rx="2" fill="#f7d57b"/></g><circle cx="-5" cy="0" r="4" fill="#e9edf0"/>`;
            case "car": return `<rect x="-15" y="-8" width="30" height="16" rx="6" fill="${c}"/><rect x="-6" y="-8" width="8" height="16" fill="${k}"/><rect x="5" y="-6" width="5" height="12" rx="2" fill="#f6f7f8"/>`;
            case "heli": return `<ellipse cx="0" cy="0" rx="14" ry="6" fill="${c}"/><rect x="-32" y="-1.5" width="19" height="3" fill="${c}"/><circle cx="-32" cy="0" r="3" fill="${k}"/><rect x="2" y="-7" width="8" height="14" fill="${c}"/><g class="rw-heli-rotor"><path d="M0 -16 L0 16"/><path d="M-16 0 L16 0"/></g>`;
            default: return "";
        }
    }

    function buildFleet() {
        const layer = dom.section.querySelector("#railwayFleet");
        if (!layer || fx.built) return;

        dom.bridgePath = dom.section.querySelector("#serviceBridgePath");
        fx.verdict = dom.section.querySelector("#railwayVerdict");
        fx.stageLabel = dom.section.querySelector("#railwayStage");
        fx.cycleNumber = dom.section.querySelector("#railwayCycle");
        fx.turbine = dom.section.querySelector("#railwayTurbine");
        fx.mainTurbine = document.getElementById("turbine");
        if (!dom.servicePath || !dom.bridgePath) return;

        CATALOG.filter(s => s.kind).forEach(s => {
            const g = document.createElementNS(SVG_NS, "g");
            g.setAttribute("class", `rw-veh rw-veh-${s.kind}`);
            g.setAttribute("data-vehicle", s.tb);
            g.innerHTML = `<title>${s.name}${s.num ? " " + s.num : ""} · ${s.tb} · ${s.code}</title>` +
                (s.kind === "heli" ? `<ellipse class="rw-heli-shadow" cx="0" cy="0" rx="14" ry="6"/>` : "") +
                `<g class="rw-veh-body">${vehicleMarkup(s)}</g>` +
                (s.id === "diesel" ? `<rect class="rw-cargo" x="-8" y="-5" width="12" height="10" rx="2" visibility="hidden"/>` : "") +
                `<text class="rw-veh-label" y="${s.kind === "heli" ? 34 : 24}" text-anchor="middle">${s.label}</text>`;
            layer.appendChild(g);
            fleet[s.id] = {
                spec: s, el: g, body: g.querySelector(".rw-veh-body"), arm: g.querySelector(".rw-arm"),
                shadow: g.querySelector(".rw-heli-shadow"), cargo: g.querySelector(".rw-cargo"),
                x: s.x, y: s.y, a: s.a || 0, ex: s.x, ey: s.y, q: [], tot: 0, done: 0, armT: 0,
                speed: s.kind === "heli" ? AIR_SPEED : VISUAL_SPEED,
                maxSpeed: s.kind === "heli" ? AIR_SPEED : VISUAL_SPEED,
                turnBias: s.kind === "heli" ? 12 : 10
            };
        });

        const ripLayer = dom.section.querySelector("#railwayRipples");
        if (ripLayer) {
            for (let i = 0; i < 3; i++) {
                const el = document.createElementNS(SVG_NS, "circle");
                el.setAttribute("class", "rw-ripple");
                el.setAttribute("opacity", "0");
                ripLayer.appendChild(el);
                ripples.pool.push({ el, on: false, x: 0, y: 0, r: 0 });
            }
        }

        const body = dom.section.querySelector("#railwayCatalog");
        if (body) {
            body.innerHTML = CATALOG.map(s =>
                `<tr><td>${s.photo}</td><td>${s.name}${s.num ? " " + s.num : ""}</td><td>${s.tb}</td><td>${s.code}</td><td>${s.func}</td></tr>`
            ).join("");
        }

        fx.built = true;
        applyFleet();
    }

    /* ----- rotas ----- */

    function drive(v, pts) {
        if (!v.q.length) { v.tot = 0; v.done = 0; }
        pts.forEach(p => {
            v.tot += Math.hypot(p.x - v.ex, p.y - v.ey);
            v.q.push({ x: p.x, y: p.y });
            v.ex = p.x; v.ey = p.y;
        });
    }
    const hold = (v, s) => v.q.push({ wait: s });
    const go = (v, x, y) => drive(v, [{ x, y }]);

    function nearestLen(path, x, y) {
        const T = path.getTotalLength();
        let best = 0, bd = Infinity;
        for (let i = 0; i <= 720; i++) {
            const l = (T * i) / 720, p = path.getPointAtLength(l);
            const d = (p.x - x) ** 2 + (p.y - y) ** 2;
            if (d < bd) { bd = d; best = l; }
        }
        return best;
    }

    // Segue a ferrovia amarela (fechada) pelo menor sentido.
    function railTo(v, x, y) {
        const path = dom.servicePath, T = path.getTotalLength();
        const from = nearestLen(path, v.ex, v.ey), to = nearestLen(path, x, y);
        const fwd = (to - from + T) % T, dir = fwd <= T - fwd ? 1 : -1, dist = dir > 0 ? fwd : T - fwd;
        const n = Math.max(2, Math.ceil(dist / 10));
        const pts = [];
        for (let i = 0; i <= n; i++) {
            const p = path.getPointAtLength(wrap(from + (dir * dist * i) / n, T));
            pts.push({ x: p.x, y: p.y });
        }
        pts.push({ x, y });
        drive(v, pts);
    }

    function rampPts(fromLen, toLen) {
        const n = Math.max(2, Math.ceil(Math.abs(toLen - fromLen) / 10)), pts = [];
        for (let i = 1; i <= n; i++) {
            const p = dom.bridgePath.getPointAtLength(fromLen + ((toLen - fromLen) * i) / n);
            pts.push({ x: p.x, y: p.y });
        }
        return pts;
    }
    const rampUp = fromLen => rampPts(fromLen, 0);
    const rampDown = toLen => rampPts(0, toLen);

    function ringPts(a, b) {
        const n = Math.max(1, Math.ceil(Math.abs(b - a) / 5)), pts = [];
        for (let i = 1; i <= n; i++) pts.push(ringPt(a + ((b - a) * i) / n));
        return pts;
    }

    function rampLen(x, y) { return nearestLen(dom.bridgePath, x, y); }

    function toRing(v) {
        const s = v.spec, deg = s.ring < 90 ? s.ring + 360 : s.ring;
        if (s.rail) {
            railTo(v, RAMP_BASE.x, RAMP_BASE.y);
            drive(v, rampUp(dom.bridgePath.getTotalLength()));
            drive(v, ringPts(90, deg));
        } else {
            go(v, ...Object.values(ringPt(s.ring)));
        }
        hold(v, 3);
    }

    function leaveRing(v) {
        const s = v.spec;
        if (s.rail) {
            drive(v, ringPts(s.ring, 450));
            drive(v, rampDown(dom.bridgePath.getTotalLength()));
        }
    }

    function toTurbine(v) {
        const s = v.spec;
        if (s.rail) {
            leaveRing(v);
            railTo(v, s.id === "thomas" ? 862 : 874, s.id === "thomas" ? 310 : 385);
        } else {
            const p = { x: TURBINE_PAD.x + TURBINE_PAD.r * Math.cos(s.turb * A2R), y: TURBINE_PAD.y + TURBINE_PAD.r * Math.sin(s.turb * A2R) };
            go(v, p.x, p.y);
        }
        hold(v, 0.4);
    }

    function goHome(v) {
        const s = v.spec;
        if (s.rail || s.track) railTo(v, s.x, s.y);
        else if (s.viaRamp) { railTo(v, RAMP_BASE.x, RAMP_BASE.y); go(v, s.x, s.y); }
        else go(v, s.x, s.y);
    }

    const ALL_WORKERS = ["thomas", "diesel", "kevin", "george", "byron", "henry", "jack13", "jack16"];
    const WORKFLOW_ROLES = {
        thomas: "transporte ferroviário",
        diesel: "locomotiva de logística",
        henry: "transporte pesado",
        byron: "preparação do terreno",
        george: "compactação e pavimentação",
        kevin: "organização de suprimentos",
        jack13: "movimentação de cascalho",
        jack16: "movimentação de cascalho",
        winston: "inspeção terrestre",
        harold: "inspeção aérea",
        hogwarts: "circulação especial"
    };
    const INSPECTION_TEAM = ["winston", "harold", "thomas", "diesel", "henry"];
    const FINAL_CONVERGENCE = ALL_WORKERS.concat(["winston", "harold"]);
    const ZONE = [{ x: 440, y: 225 }, { x: 590, y: 225 }, { x: 590, y: 262 }, { x: 440, y: 262 }, { x: 440, y: 299 }, { x: 590, y: 299 }];

    function say(text, ok) {
        if (!fx.verdict) return;
        fx.verdict.style.display = text ? "" : "none";
        fx.verdict.classList.toggle("is-approved", !!ok);
        const t = fx.verdict.querySelector("text");
        if (t && text) t.textContent = text;
    }

    function turbineMode(mode) { // "off" | "slow" | "climax"
        if (fx.turbine) {
            fx.turbine.classList.toggle("is-spin", mode !== "off");
            fx.turbine.classList.toggle("is-climax", mode === "climax");
        }
        // Gancho visual no rotor da pagina principal: so atua quando a simulacao
        // da turbina NAO esta girando (script.js nao e alterado).
        if (fx.mainTurbine) {
            fx.mainTurbine.classList.toggle("cycle-spin", mode !== "off");
            fx.mainTurbine.style.setProperty("--cycle-spin", mode === "climax" ? "0.35s" : "1.4s");
        }
    }

    function enforceRoles() {
        Object.entries(WORKFLOW_ROLES).forEach(([id, description]) => {
            const vehicle = fleet[id];
            if (!vehicle || !vehicle.spec) return;
            vehicle.spec.func = description;
        });
    }

    function centralInspectionSequence() {
        INSPECTION_TEAM.forEach(id => {
            if (!fleet[id]) return;
            const v = fleet[id];
            if (id === "harold") {
                const pts = [{ x: 500, y: 205 }];
                for (let d = -80; d <= 280; d += 10) pts.push({ x: 500 + 300 * Math.cos(d * A2R), y: 500 + 290 * Math.sin(d * A2R) });
                pts.push({ x: 500, y: 500 });
                hold(v, 0.5); drive(v, pts);
            } else if (id === "winston") {
                const L = rampLen(RAMP_CROSS.x, RAMP_CROSS.y);
                go(v, RAMP_CROSS.x, RAMP_CROSS.y); drive(v, rampUp(L)); drive(v, ringPts(90, 630));
            } else {
                toRing(v);
            }
        });
    }

    /* [rotulo, entrada, tempo minimo em segundos] */
    const STAGES = [
        ["Preparação do local", () => { drive(fleet.byron, ZONE); }, 0],
        ["Trabalho no terreno", () => {
            goHome(fleet.byron); drive(fleet.george, ZONE);
            railTo(fleet.thomas, 866, 330); hold(fleet.thomas, 0.4); railTo(fleet.thomas, fleet.thomas.spec.x, fleet.thomas.spec.y);
        }, 0],
        ["Extração e manuseio de materiais", () => {
            railTo(fleet.jack16, 222, 893);
            go(fleet.jack13, RAMP_BASE.x, RAMP_BASE.y); railTo(fleet.jack13, 186, 920);
        }, 0],
        ["Carregamento", () => { if (fleet.diesel.cargo) fleet.diesel.cargo.setAttribute("visibility", "visible"); hold(fleet.jack16, 1.8); hold(fleet.jack13, 1.8); }, 2],
        ["Transporte ferroviário", () => { railTo(fleet.diesel, 172, 168); }, 0],
        ["Descarga no Kevin", () => { fleet.kevin.armT = 2.8; hold(fleet.diesel, 2.8); }, 0],
        ["Retorno e organização das máquinas", () => {
            goHome(fleet.diesel); goHome(fleet.jack16); goHome(fleet.jack13); goHome(fleet.george); goHome(fleet.kevin);
        }, 0],
        ["Inspeção terrestre (Winston)", () => {
            const w = fleet.winston, L = rampLen(RAMP_CROSS.x, RAMP_CROSS.y);
            go(w, RAMP_CROSS.x, RAMP_CROSS.y); drive(w, rampUp(L)); drive(w, ringPts(90, 630));
        }, 0],
        ["Passagem dos veículos pela região central", () => { ALL_WORKERS.forEach(id => toRing(fleet[id])); centralInspectionSequence(); }, 0],
        ["Apoio aéreo (Harold)", () => {
            const h = fleet.harold, pts = [{ x: 500, y: 205 }];
            for (let d = -80; d <= 280; d += 10) pts.push({ x: 500 + 300 * Math.cos(d * A2R), y: 500 + 290 * Math.sin(d * A2R) });
            pts.push({ x: 500, y: 500 });
            hold(h, 0.5); drive(h, pts);
        }, 0],
        ["Avaliação de Sir Topham Hatt", () => say("SIR TOPHAM HATT AVALIANDO…", false), 3],
        ["Veredito da inspeção", () => say("VEREDITO: OPERAÇÃO APROVADA", true), 3.5],
        ["Conclusão das operações", () => {
            say("");
            const w = fleet.winston, L = rampLen(RAMP_CROSS.x, RAMP_CROSS.y);
            drive(w, ringPts(270, 450)); drive(w, rampDown(L)); go(w, w.spec.x, w.spec.y);
        }, 0],
        ["Convergência para a região da turbina", () => { FINAL_CONVERGENCE.forEach(id => toTurbine(fleet[id])); }, 0],
        ["Início da rotação da turbina", () => turbineMode("slow"), 2.5],
        ["Clímax: turbina em rotação máxima", () => turbineMode("climax"), 6],
        ["Conclusão do ciclo", () => turbineMode("slow"), 2],
        ["Retorno às posições iniciais", () => { turbineMode("off"); ALL_WORKERS.forEach(id => goHome(fleet[id])); }, 0],
        ["Reinício do ciclo", () => {}, 2]
    ];

    function allIdle() {
        return Object.values(fleet).every(v => !v.q.length && v.armT <= 0);
    }

    function enterStage(i) {
        cyc.i = i; cyc.t = 0;
        if (i === 0) cyc.n += 1;
        STAGES[i][1]();
        setText(fx.stageLabel, `${i + 1}/${STAGES.length} · ${STAGES[i][0]}`);
        setText(fx.cycleNumber, String(cyc.n));
        document.dispatchEvent(new CustomEvent("terrabyte:railway-stage", { detail: { index: i + 1, label: STAGES[i][0], cycle: cyc.n } }));
    }

    /* ----- movimento ----- */

    function stepVehicle(v, dt) {
        const accel = v.spec.kind === "heli" ? 120 : 140;
        const brake = v.spec.kind === "heli" ? 100 : 120;
        const desired = v.q.length ? v.maxSpeed : 0;

        if (desired > v.speed) {
            v.speed = Math.min(desired, v.speed + accel * dt);
        } else if (desired < v.speed) {
            v.speed = Math.max(0, v.speed - brake * dt);
        }

        let rem = dt, target = null;
        while (rem > 0 && v.q.length) {
            const t = v.q[0];
            if (t.wait !== undefined) {
                if (t.wait > rem) { t.wait -= rem; rem = 0; } else { rem -= t.wait; v.q.shift(); }
                continue;
            }
            const dx = t.x - v.x, dy = t.y - v.y, d = Math.hypot(dx, dy);
            if (d < 1e-6) { v.q.shift(); continue; }
            target = Math.atan2(dy, dx) / A2R;
            const moveSpeed = Math.max(v.speed, 0.01);
            const need = d / moveSpeed;
            if (need > rem) {
                v.x += (dx / d) * moveSpeed * rem;
                v.y += (dy / d) * moveSpeed * rem;
                v.done += moveSpeed * rem;
                rem = 0;
            } else {
                v.x = t.x; v.y = t.y; v.done += d; rem -= need; v.q.shift();
            }
        }

        if (target !== null) {
            const diff = ((target - v.a + 540) % 360) - 180;
            v.a += diff * Math.min(1, dt * (v.turnBias ?? 10));
        }

        if (v.armT > 0) {
            v.armT = Math.max(0, v.armT - dt);
            if (v.armT === 0 && fleet.diesel.cargo) fleet.diesel.cargo.setAttribute("visibility", "hidden");
        }
    }

    function applyFleet() {
        Object.values(fleet).forEach(v => {
            const flying = v.spec.kind === "heli" && v.q.length > 0;
            const alt = flying && v.tot > 0 ? Math.sin(Math.PI * Math.min(1, v.done / v.tot)) : 0;
            v.el.setAttribute("transform", `translate(${v.x.toFixed(1)} ${v.y.toFixed(1)})`);
            v.body.setAttribute("transform", `rotate(${v.a.toFixed(1)}) scale(${(1 + 0.4 * alt).toFixed(3)})`);
            v.el.dataset.flying = flying ? "1" : "0";
            if (v.shadow) {
                v.shadow.setAttribute("transform", `translate(${(alt * 16).toFixed(1)} ${(alt * 20).toFixed(1)}) rotate(${v.a.toFixed(1)})`);
                v.shadow.setAttribute("opacity", (0.28 - 0.1 * alt).toFixed(2));
            }
            if (v.arm) {
                const ang = v.armT > 0 ? 38 * Math.sin((2.8 - v.armT) * 3.2) : 0;
                v.arm.setAttribute("transform", `translate(4 0) rotate(${ang.toFixed(1)})`);
            }
        });
    }

    function rippleStep(dt) {
        const t = fleet.thomas;
        ripples.cool -= dt;
        if (t.q.length && ripples.cool <= 0 && Math.hypot(t.x - POND.x, t.y - POND.y) < 110) {
            const r = ripples.pool.find(p => !p.on);
            if (r) {
                r.on = true; r.r = 3; ripples.cool = 0.5;
                r.x = t.x + (POND.x - t.x) * 0.35; r.y = t.y + (POND.y - t.y) * 0.35;
            }
        }
        ripples.pool.forEach(p => {
            if (!p.on) return;
            p.r += 26 * dt;
            const o = 1 - p.r / 34;
            if (o <= 0) { p.on = false; p.el.setAttribute("opacity", "0"); return; }
            p.el.setAttribute("cx", p.x.toFixed(1)); p.el.setAttribute("cy", p.y.toFixed(1));
            p.el.setAttribute("r", p.r.toFixed(1)); p.el.setAttribute("opacity", (o * 0.7).toFixed(2));
        });
    }

    function fleetStep(dt) {
        if (!fx.built) return;
        if (cyc.i < 0) enterStage(0);
        cyc.t += dt;
        Object.values(fleet).forEach(v => stepVehicle(v, dt));
        rippleStep(dt);
        applyFleet();
        if (cyc.t >= STAGES[cyc.i][2] && allIdle()) enterStage((cyc.i + 1) % STAGES.length);
    }

    function fleetReset() {
        if (!fx.built) return;
        Object.values(fleet).forEach(v => {
            v.x = v.ex = v.spec.x; v.y = v.ey = v.spec.y; v.a = v.spec.a || 0;
            v.q = []; v.tot = 0; v.done = 0; v.armT = 0; v.speed = v.maxSpeed;
        });
        if (fleet.diesel.cargo) fleet.diesel.cargo.setAttribute("visibility", "hidden");
        ripples.pool.forEach(p => { p.on = false; p.el.setAttribute("opacity", "0"); });
        cyc.i = -1; cyc.t = 0; cyc.n = 0;
        say(""); turbineMode("off");
        setText(fx.stageLabel, "Aguardando início");
        setText(fx.cycleNumber, "0");
        applyFleet();
    }

    /* ---------- API PUBLICA ---------- */

    function start() {
        if (!dom.ready || state.running || state.started) return false;

        state.started = true;
        state.running = true;
        state.previousTimestamp = null;

        syncControls();
        state.animationFrame = requestAnimationFrame(frame);
        return true;
    }

    function pause() {
        if (!state.running) return false;

        state.running = false;
        cancelFrame();
        syncControls();
        return true;
    }

    function resume() {
        if (!dom.ready || state.running || !state.started) return false;

        state.running = true;
        state.previousTimestamp = null;

        syncControls();
        state.animationFrame = requestAnimationFrame(frame);
        return true;
    }

    function reset() {
        state.running = false;
        state.started = false;
        state.elapsedSeconds = 0;
        state.distanceMeters = 0;
        cancelFrame();

        fleetReset();
        syncControls();
        render();
    }

    // Uso em testes: fixa a velocidade dentro da faixa estimada (1 a 2 km/h).
    // A interface publica nao oferece controle deslizante de velocidade.
    function setSpeedKmh(kmh) {
        const value = Number(kmh);

        if (!Number.isFinite(value)) return state.speedKmh;

        state.speedKmh = Math.min(
            Math.max(value, PASSENGER_SPEED_MIN_KMH),
            PASSENGER_SPEED_MAX_KMH
        );

        render();
        return state.speedKmh;
    }

    function getState() {
        return {
            running: state.running,
            started: state.started,
            elapsedSeconds: state.elapsedSeconds,
            distanceMeters: state.distanceMeters,
            laps: Math.floor(state.distanceMeters / TRACK_CIRCUMFERENCE_METERS),
            lapProgress: trackLapProgress(),
            speedKmh: state.speedKmh,
            speedMs: kmhToMs(state.speedKmh),
            lapSeconds: currentLapSeconds(),
            physical: {
                trainModel: TRAIN_MODEL,
                trackBoundingBoxCm: TRACK_BOUNDING_BOX_CM,
                trackDiameterMeters: TRACK_DIAMETER_METERS,
                trackCircumferenceMeters: TRACK_CIRCUMFERENCE_METERS,
                circumferenceIsApproximation: true
            },
            cycle: { stage: cyc.i + 1, stages: STAGES.length, label: cyc.i >= 0 ? STAGES[cyc.i][0] : null, cycleNumber: cyc.n },
            fleet: Object.fromEntries(Object.entries(fleet).map(([id, v]) => [id, { x: v.x, y: v.y, idle: !v.q.length }])),
            // Diferenca entre o desenho e o circuito fisico, mantida explicita.
            svg: {
                passengerPathLengthUnits: passengerPathLength,
                unitsPerPhysicalMeter: passengerPathLength / TRACK_CIRCUMFERENCE_METERS
            }
        };
    }

    function init() {
        if (dom.ready) return true;

        dom.section = document.getElementById("railwaySection");
        if (!dom.section) return false;

        dom.passengerPath = dom.section.querySelector("#passengerRailwayPath");
        dom.servicePath = dom.section.querySelector("#serviceRailwayPath");
        dom.trainGroup = dom.section.querySelector("#passengerTrain");
        dom.startButton = dom.section.querySelector("#railwayStart");
        dom.pauseButton = dom.section.querySelector("#railwayPause");
        dom.continueButton = dom.section.querySelector("#railwayContinue");
        dom.resetButton = dom.section.querySelector("#railwayReset");
        dom.status = dom.section.querySelector("#railwayStatus");
        dom.speedValue = dom.section.querySelector("#railwaySpeedValue");
        dom.circuitLength = dom.section.querySelector("#railwayCircuitLength");
        dom.lapTime = dom.section.querySelector("#railwayLapTime");
        dom.distance = dom.section.querySelector("#railwayDistance");
        dom.laps = dom.section.querySelector("#railwayLaps");

        if (
            !dom.passengerPath || !dom.trainGroup ||
            !dom.startButton || !dom.pauseButton ||
            !dom.continueButton || !dom.resetButton
        ) {
            return false;
        }

        passengerPathLength = dom.passengerPath.getTotalLength();
        if (!(passengerPathLength > 0)) return false;

        dom.cars = buildCars(dom.trainGroup);
        if (dom.cars.length === 0) return false;

        dom.parked = Array.from(dom.section.querySelectorAll("[data-service-progress]"));
        dom.ready = true;

        if (!dom.bound) {
            dom.startButton.addEventListener("click", start);
            dom.pauseButton.addEventListener("click", pause);
            dom.continueButton.addEventListener("click", resume);
            dom.resetButton.addEventListener("click", reset);

            // Ao voltar de outra aba, descarta o intervalo parado.
            document.addEventListener("visibilitychange", () => {
                state.previousTimestamp = null;
            });

            dom.bound = true;
        }

        enforceRoles();
        buildFleet();
        placeParkedUnits();
        syncControls();
        render();
        return true;
    }

    window.TerraByteRailway = Object.freeze({
        init,
        start,
        pause,
        resume,
        reset,
        update,
        setSpeedKmh,
        getState
    });

    init();
})();

