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

    function placeOnPath(path, element, lengthAlongPath) {
        const total = path.getTotalLength();
        const s = wrap(lengthAlongPath, total);
        const point = path.getPointAtLength(s);
        const before = path.getPointAtLength(wrap(s - TANGENT_SAMPLE_UNITS, total));
        const after = path.getPointAtLength(wrap(s + TANGENT_SAMPLE_UNITS, total));
        const angle = Math.atan2(after.y - before.y, after.x - before.x) * 180 / Math.PI;

        element.setAttribute(
            "transform",
            `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) rotate(${angle.toFixed(2)})`
        );
    }

    function placeTrain() {
        if (!dom.ready) return;

        // A locomotiva e a referencia; cada unidade fica no seu proprio ponto do
        // trilho, acompanhando a curva (articulado), e nao um bloco rigido.
        const headLength = trackLapProgress() * passengerPathLength;

        dom.cars.forEach(car => {
            placeOnPath(dom.passengerPath, car.element, headLength - car.offsetUnits);
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