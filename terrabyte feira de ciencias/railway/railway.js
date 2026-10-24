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
    const TRAIN_MODEL = "Expresso de Hogwarts (Candide)";
    const TRACK_BOUNDING_BOX_CM = 68;

    const PASSENGER_SPEED_MIN_KMH = 1.0;
    const PASSENGER_SPEED_REFERENCE_KMH = 1.5;
    const PASSENGER_SPEED_MAX_KMH = 2.0;

    const TRACK_DIAMETER_METERS = TRACK_BOUNDING_BOX_CM / 100;
    const TRACK_CIRCUMFERENCE_METERS = Math.PI * TRACK_DIAMETER_METERS;
    const kmhToMs = kmh => kmh / 3.6;
    const PASSENGER_SPEED_REFERENCE_MS = kmhToMs(PASSENGER_SPEED_REFERENCE_KMH);
    const lapSecondsAt = kmh => TRACK_CIRCUMFERENCE_METERS / kmhToMs(kmh);

    const MAX_FRAME_DELTA_SECONDS = 0.1;
    const TRAIN_COUPLING_GAP_UNITS = 5;
    const TANGENT_SAMPLE_UNITS = 3;
    const TRAIN_START_PROGRESS = 0.25;
    const PASSENGER_DIRECTION = -1;

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
        bridgePath: null,
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
    const wrap = (value, length) => ((value % length) + length) % length;
    const setText = (element, value) => { if (element) element.textContent = value; };
    const formatNumber = (value, decimals) => new Intl.NumberFormat("pt-BR", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    }).format(value);

    function trackLapProgress() {
        return wrap(state.distanceMeters, TRACK_CIRCUMFERENCE_METERS) / TRACK_CIRCUMFERENCE_METERS;
    }

    function placeOnPath(path, element, lengthAlongPath, flip = false) {
        const total = path.getTotalLength();
        const s = wrap(lengthAlongPath, total);
        const point = path.getPointAtLength(s);
        const before = path.getPointAtLength(wrap(s - TANGENT_SAMPLE_UNITS, total));
        const after = path.getPointAtLength(wrap(s + TANGENT_SAMPLE_UNITS, total));
        const angle = Math.atan2(after.y - before.y, after.x - before.x) * 180 / Math.PI + (flip ? 180 : 0);
        element.setAttribute("transform", `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) rotate(${angle.toFixed(2)})`);
    }

    function placeTrain() {
        if (!dom.ready) return;
        const headLength = wrap(
            (TRAIN_START_PROGRESS + PASSENGER_DIRECTION * trackLapProgress()) * passengerPathLength,
            passengerPathLength
        );

        dom.cars.forEach(car => {
            placeOnPath(dom.passengerPath, car.element, headLength - PASSENGER_DIRECTION * car.offsetUnits, PASSENGER_DIRECTION < 0);
        });
    }

    function buildCars(trainGroup) {
        const elements = Array.from(trainGroup.querySelectorAll("[data-train-car]"));
        const cars = [];
        let cursor = 0;

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
        if (!dom.servicePath) return;
        const total = dom.servicePath.getTotalLength();
        dom.parked.forEach(element => {
            const fraction = Number(element.getAttribute("data-service-progress")) || 0;
            placeOnPath(dom.servicePath, element, fraction * total);
        });
    }

    function currentLapSeconds() {
        return lapSecondsAt(state.speedKmh);
    }

    function render() {
        if (!dom.ready) return;
        setText(dom.speedValue, `${formatNumber(state.speedKmh, 1)} km/h`);
        setText(dom.circuitLength, `${formatNumber(TRACK_CIRCUMFERENCE_METERS, 3)} m`);
        setText(dom.lapTime, `${formatNumber(currentLapSeconds(), 2)} s`);
        setText(dom.distance, `${formatNumber(state.distanceMeters, 2)} m`);
        setText(dom.laps, String(Math.floor(state.distanceMeters / TRACK_CIRCUMFERENCE_METERS)));
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

    function update(deltaSeconds) {
        if (!state.running) return;
        const delta = Math.min(Math.max(0, Number(deltaSeconds) || 0), MAX_FRAME_DELTA_SECONDS);
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

    const SVG_NS = "http://www.w3.org/2000/svg";
    const VISUAL_SPEED = 150;
    const RING = { cx: 500, cy: 500, r: 135 };
    const TURBINE_PAD = { x: 700, y: 365, r: 62 };
    const POND = { x: 805, y: 222 };
    const RAMP_BASE = { x: 790, y: 893 };
    const RAMP_CROSS = { x: 675, y: 780 };
    const A2R = Math.PI / 180;
    const ringPt = (deg, r = RING.r) => ({ x: RING.cx + r * Math.cos(deg * A2R), y: RING.cy + r * Math.sin(deg * A2R) });

    const CATALOG = [
        { id: "thomas", name: "Thomas", num: "Nº 1", tb: "TB-VEH-001", code: "J06A", photo: "1", kind: "loco", label: "Thomas", c: "#2f86d4", c2: "#1b5a9a", x: 771, y: 161, a: 40, rail: true, ring: 160, func: "Operação ferroviária na área azul/água" },
        { id: "diesel", name: "Diesel", num: "Nº 10", tb: "TB-VEH-010", code: "F4DA", photo: "4 (inferior)", kind: "loco", label: "Diesel", c: "#2a2a30", c2: "#b3261e", x: 118, y: 868, a: -55, rail: true, ring: 200, func: "Transporte ferroviário ligado à extração" },
        { id: "henry", name: "Henry", num: "Nº 3", tb: "TB-VEH-025", code: "G05A", photo: "3", kind: "loco", label: "Henry", c: "#2e9a52", c2: "#1f6e3a", x: 760, y: 404, a: 100, rail: true, ring: 20, turb: 20, func: "Operação ferroviária próxima à turbina" }
    ];

    const fleet = {};
    const cyc = { i: -1, t: 0, n: 0 };
    const ripples = { cool: 0, pool: [] };
    const fx = { built: false, verdict: null, stageLabel: null, cycleNumber: null, turbine: null, mainTurbine: null };

    function vehicleMarkup(s) {
        const c = s.c;
        const k = s.c2;
        const d = "#26262b";
        switch (s.kind) {
            case "loco":
                return `<rect x="-20" y="-8" width="40" height="16" rx="4" fill="${c}"/><rect x="-20" y="-8" width="13" height="16" rx="3" fill="${k}"/><rect x="-5" y="-6" width="20" height="12" rx="6" fill="${c}"/><circle cx="12" cy="0" r="3.6" fill="${d}"/><rect x="-3" y="-1" width="14" height="2" fill="${k}"/>`;
            default:
                return "";
        }
    }

    function buildFleet() {
        const layer = dom.section.querySelector("#railwayFleet") || dom.section.querySelector("#railwaySimulation");
        if (!layer || fx.built) return;

        dom.bridgePath = dom.section.querySelector("#serviceBridgePath") || dom.servicePath;
        fx.verdict = dom.section.querySelector("#railwayVerdict");
        fx.stageLabel = dom.section.querySelector("#railwayStage");
        fx.cycleNumber = dom.section.querySelector("#railwayCycle");
        fx.turbine = dom.section.querySelector("#railwayTurbine");
        fx.mainTurbine = document.getElementById("turbine");

        CATALOG.filter(s => s.kind).forEach(s => {
            const g = document.createElementNS(SVG_NS, "g");
            g.setAttribute("class", `rw-veh rw-veh-${s.kind}`);
            g.setAttribute("data-vehicle", s.tb);
            g.innerHTML = `<title>${s.name}${s.num ? " " + s.num : ""} · ${s.tb} · ${s.code}</title><g class="rw-veh-body">${vehicleMarkup(s)}</g><text class="rw-veh-label" y="24" text-anchor="middle">${s.label}</text>`;
            layer.appendChild(g);
            fleet[s.id] = {
                spec: s,
                el: g,
                body: g.querySelector(".rw-veh-body"),
                arm: null,
                shadow: null,
                cargo: null,
                x: s.x,
                y: s.y,
                a: s.a || 0,
                ex: s.x,
                ey: s.y,
                q: [],
                tot: 0,
                done: 0,
                armT: 0,
                speed: VISUAL_SPEED,
                maxSpeed: VISUAL_SPEED,
                turnBias: 10
            };
        });

        fx.built = true;
        applyFleet();
    }

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
        let best = 0;
        let bd = Infinity;
        for (let i = 0; i <= 720; i++) {
            const l = (T * i) / 720;
            const p = path.getPointAtLength(l);
            const d = (p.x - x) ** 2 + (p.y - y) ** 2;
            if (d < bd) { bd = d; best = l; }
        }
        return best;
    }

    function railTo(v, x, y) {
        const path = dom.servicePath;
        const T = path.getTotalLength();
        const from = nearestLen(path, v.ex, v.ey);
        const to = nearestLen(path, x, y);
        const fwd = (to - from + T) % T;
        const dir = fwd <= T - fwd ? 1 : -1;
        const dist = dir > 0 ? fwd : T - fwd;
        const n = Math.max(2, Math.ceil(dist / 10));
        const pts = [];
        for (let i = 0; i <= n; i++) {
            const p = path.getPointAtLength(wrap(from + (dir * dist * i) / n, T));
            pts.push({ x: p.x, y: p.y });
        }
        pts.push({ x, y });
        drive(v, pts);
    }

    function toTurbine(v) {
        const s = v.spec;
        const target = s.id === "thomas" ? { x: 862, y: 310 } : s.id === "diesel" ? { x: 874, y: 385 } : { x: 840, y: 420 };
        railTo(v, target.x, target.y);
        hold(v, 0.4);
    }

    function goHome(v) {
        const s = v.spec;
        railTo(v, s.x, s.y);
    }

    function say(text, ok) {
        if (!fx.verdict) return;
        fx.verdict.style.display = text ? "" : "none";
        fx.verdict.classList.toggle("is-approved", !!ok);
        const t = fx.verdict.querySelector("text");
        if (t && text) t.textContent = text;
    }

    function allIdle() {
        return Object.values(fleet).every(v => !v.q.length && v.armT <= 0);
    }

    const STAGES = [
        ["Thomas em ação", () => { railTo(fleet.thomas, 866, 330); }, 0],
        ["Diesel em logística", () => { railTo(fleet.diesel, 172, 168); }, 0],
        ["Henry em transporte pesado", () => { railTo(fleet.henry, 874, 385); }, 0],
        ["Convergência dos três", () => { ["thomas", "diesel", "henry"].forEach(id => toTurbine(fleet[id])); }, 0],
        ["Retorno para posições iniciais", () => { ["thomas", "diesel", "henry"].forEach(id => goHome(fleet[id])); }, 0],
        ["Reinício do ciclo", () => { say(""); }, 1.5]
    ];

    function enterStage(i) {
        cyc.i = i;
        cyc.t = 0;
        if (i === 0) cyc.n += 1;
        STAGES[i][1]();
        setText(fx.stageLabel, `${i + 1}/${STAGES.length} · ${STAGES[i][0]}`);
        setText(fx.cycleNumber, String(cyc.n));
        document.dispatchEvent(new CustomEvent("terrabyte:railway-stage", { detail: { index: i + 1, label: STAGES[i][0], cycle: cyc.n } }));
    }

    function stepVehicle(v, dt) {
        const accel = 140;
        const brake = 120;
        const desired = v.q.length ? v.maxSpeed : 0;

        if (desired > v.speed) {
            v.speed = Math.min(desired, v.speed + accel * dt);
        } else if (desired < v.speed) {
            v.speed = Math.max(0, v.speed - brake * dt);
        }

        let rem = dt;
        let target = null;
        while (rem > 0 && v.q.length) {
            const t = v.q[0];
            if (t.wait !== undefined) {
                if (t.wait > rem) { t.wait -= rem; rem = 0; } else { rem -= t.wait; v.q.shift(); }
                continue;
            }
            const dx = t.x - v.x;
            const dy = t.y - v.y;
            const d = Math.hypot(dx, dy);
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
                v.x = t.x;
                v.y = t.y;
                v.done += d;
                rem -= need;
                v.q.shift();
            }
        }

        if (target !== null) {
            const diff = ((target - v.a + 540) % 360) - 180;
            v.a += diff * Math.min(1, dt * (v.turnBias ?? 10));
        }
    }

    function applyFleet() {
        Object.values(fleet).forEach(v => {
            v.el.setAttribute("transform", `translate(${v.x.toFixed(1)} ${v.y.toFixed(1)})`);
            v.body.setAttribute("transform", `rotate(${v.a.toFixed(1)})`);
        });
    }

    function fleetStep(dt) {
        if (!fx.built) return;
        if (cyc.i < 0) enterStage(0);
        cyc.t += dt;
        Object.values(fleet).forEach(v => stepVehicle(v, dt));
        applyFleet();
        if (cyc.t >= STAGES[cyc.i][2] && allIdle()) enterStage((cyc.i + 1) % STAGES.length);
    }

    function fleetReset() {
        if (!fx.built) return;
        Object.values(fleet).forEach(v => {
            v.x = v.ex = v.spec.x;
            v.y = v.ey = v.spec.y;
            v.a = v.spec.a || 0;
            v.q = [];
            v.tot = 0;
            v.done = 0;
            v.armT = 0;
            v.speed = v.maxSpeed;
        });
        cyc.i = -1;
        cyc.t = 0;
        cyc.n = 0;
        say("");
        setText(fx.stageLabel, "Aguardando início");
        setText(fx.cycleNumber, "0");
        applyFleet();
    }

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

    function setSpeedKmh(kmh) {
        const value = Number(kmh);
        if (!Number.isFinite(value)) return state.speedKmh;
        state.speedKmh = Math.min(Math.max(value, PASSENGER_SPEED_MIN_KMH), PASSENGER_SPEED_MAX_KMH);
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
            fleet: Object.fromEntries(Object.entries(fleet).map(([id, v]) => [id, { x: v.x, y: v.y, idle: !v.q.length }]))
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

        if (!dom.passengerPath || !dom.trainGroup || !dom.startButton || !dom.pauseButton || !dom.continueButton || !dom.resetButton) {
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
            document.addEventListener("visibilitychange", () => {
                state.previousTimestamp = null;
            });
            dom.bound = true;
        }

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
