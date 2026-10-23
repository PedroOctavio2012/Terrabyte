/* =========================================================
   TERRABYTE | SISTEMA DE SIMULAÇÃO EÓLICA
   JavaScript principal
   A simulação começa somente ao clicar em INICIAR SIMULAÇÃO.
   ========================================================= */

"use strict";

(() => {
    /* ---------- 1. CONFIGURAÇÕES ---------- */

    const TURBINE = {
        airDensity: 1.225,
        powerCoefficient: 0.35,
        betzLimit: 0.593,
        cutInSpeed: 1,
        maxWindSpeed: 25,
        ratedPower: 1000
    };

    // Tensão aplicada. 1,5 V é o DADO REAL informado para o protótipo.
    // O limite de sobretensão é uma premissa CONCEITUAL do modelo (não medida).
    const VOLTAGE = {
        real: 1.5,
        min: 0,
        max: 3,
        overvoltageLimit: 2.5
    };

    // Rotação estimada: escolha visual do modelo (não medida).
    const ROTOR = {
        rpmPerWindMs: 45,
        maxRpmAtRealVoltage: 900
    };

    // Valores iniciais usados no HTML, no reset e como fallback.
    const DEFAULTS = {
        wind: 12,
        area: 50,
        efficiency: 80,
        voltage: VOLTAGE.real,
        durationMinutes: 1
    };

    /* ---------- 2. ELEMENTOS DO HTML ---------- */

    const elements = {
        voltage: document.getElementById("voltage"),
        voltageValue: document.getElementById("voltageValue"),
        voltageTag: document.getElementById("voltageTag"),
        voltageData: document.getElementById("voltageData"),
        voltageDataTag: document.getElementById("voltageDataTag"),

        windSpeed: document.getElementById("windSpeed"),
        windValue: document.getElementById("windValue"),

        rotorArea: document.getElementById("rotorArea"),
        areaValue: document.getElementById("areaValue"),

        efficiency: document.getElementById("efficiency"),
        efficiencyValue: document.getElementById("efficiencyValue"),

        simulationTime: document.getElementById("simulationTime"),
        timeValue: document.getElementById("timeValue"),

        turbineArea: document.getElementById("turbineArea"),
        faultBanner: document.getElementById("faultBanner"),
        turbine: document.getElementById("turbine"),
        startButton: document.getElementById("startButton"),
        resetButton: document.getElementById("resetButton"),
        returnRealButton: document.getElementById("returnRealButton"),

        speedData: document.getElementById("speedData"),
        areaData: document.getElementById("areaData"),
        rpmData: document.getElementById("rpmData"),
        theoreticalPowerData: document.getElementById("theoreticalPowerData"),
        powerData: document.getElementById("powerData"),
        powerLimitNote: document.getElementById("powerLimitNote"),
        energyData: document.getElementById("energyData"),
        efficiencyData: document.getElementById("efficiencyData"),
        timeData: document.getElementById("timeData"),
        windStateData: document.getElementById("windStateData"),
        systemState: document.getElementById("systemState"),

        controlPanel: document.getElementById("controlPanel"),
        lockNotice: document.getElementById("lockNotice"),

        completionModal: document.getElementById("completionModal"),
        closeModal: document.getElementById("closeModal"),
        modalTime: document.getElementById("modalTime"),
        modalEfficiency: document.getElementById("modalEfficiency"),
        modalPauses: document.getElementById("modalPauses")
    };

    // Controles que alteram parâmetros da simulação (bloqueados durante a execução).
    const CONTROL_INPUTS = [
        elements.voltage,
        elements.windSpeed,
        elements.rotorArea,
        elements.efficiency,
        elements.simulationTime
    ].filter(Boolean);

    /* ---------- 3. ESTADO DA SIMULAÇÃO ---------- */

    const state = {
        running: false,
        finished: false,
        lastTimestamp: null,
        elapsedSeconds: 0,
        pausedSeconds: 0,
        hiddenAt: null,
        animationFrame: null,
        accumulatedEnergyWh: 0,
        estimatedPower: 0
    };

    /* ---------- 4. FUNÇÕES AUXILIARES ---------- */

    function formatNumber(value, decimals = 1) {
        return new Intl.NumberFormat("pt-BR", {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        }).format(value);
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function setText(element, value) {
        if (element) {
            element.textContent = value;
        }
    }

    function markTag(element, real) {
        if (!element) return;
        element.classList.toggle("tag-real", real);
        element.classList.toggle("tag-sim", !real);
    }

    function getInputs() {
        return {
            voltage: clamp(
                Number(elements.voltage?.value ?? DEFAULTS.voltage) || 0,
                VOLTAGE.min,
                VOLTAGE.max
            ),

            wind: clamp(
                Number(elements.windSpeed?.value ?? DEFAULTS.wind) || 0,
                0,
                TURBINE.maxWindSpeed
            ),

            area: Math.max(
                0,
                Number(elements.rotorArea?.value ?? DEFAULTS.area) || 0
            ),

            efficiency: clamp(
                Number(elements.efficiency?.value ?? DEFAULTS.efficiency) || 0,
                0,
                100
            ) / 100,

            durationMinutes: Math.max(
                1,
                Number(elements.simulationTime?.value ?? DEFAULTS.durationMinutes) || DEFAULTS.durationMinutes
            )
        };
    }

    function isRealVoltage(voltage) {
        return Math.abs(voltage - VOLTAGE.real) < 0.001;
    }

    function isOvervoltage(voltage) {
        return voltage > VOLTAGE.overvoltageLimit;
    }

    function formatElapsed(seconds) {
        const total = Math.max(0, Math.floor(seconds));
        const minutes = Math.floor(total / 60);
        const remainingSeconds = total % 60;

        return `${minutes} min ${String(remainingSeconds).padStart(2, "0")} s`;
    }

    /* ---------- 5. CÁLCULO DA POTÊNCIA ---------- */

    // Potência teórica: fórmula P = ½ × ρ × A × v³ × Cp × η, sem limite nominal.
    function calculateTheoreticalPower(wind, area, efficiency) {
        if (
            wind < TURBINE.cutInSpeed ||
            area <= 0 ||
            efficiency <= 0
        ) {
            return 0;
        }

        const availableWindPower =
            0.5 *
            TURBINE.airDensity *
            area *
            Math.pow(wind, 3);

        const cp = Math.min(
            TURBINE.powerCoefficient,
            TURBINE.betzLimit
        );

        return availableWindPower * cp * efficiency;
    }

    // Potência considerada pelo sistema: a teórica limitada pela potência nominal.
    function applyNominalLimit(theoreticalPower) {
        return Math.min(theoreticalPower, TURBINE.ratedPower);
    }

    function formatPower(watts) {
        if (watts >= 1000) {
            return `${formatNumber(watts / 1000, 2)} kW`;
        }

        return `${formatNumber(watts, 1)} W`;
    }

    // Rotação estimada (simulada). A tensão entra apenas aqui, em relação a 1,5 V.
    function computeRpm(wind, voltage) {
        if (wind < TURBINE.cutInSpeed || voltage <= 0) {
            return 0;
        }

        const windRpm = Math.min(
            wind * ROTOR.rpmPerWindMs,
            ROTOR.maxRpmAtRealVoltage
        );

        return windRpm * (voltage / VOLTAGE.real);
    }

    /* ---------- 6. CLASSIFICAÇÃO DO VENTO ---------- */

    function getWindDescription(speed) {
        if (speed < 1) return "CALMARIA";
        if (speed < 5) return "VENTO FRACO";
        if (speed < 11) return "VENTO MODERADO";
        if (speed < 20) return "VENTO FORTE";

        return "VENTO MUITO FORTE";
    }

    /* ---------- 7. ANIMAÇÃO DA TURBINA ---------- */

    function updateRotor(rpm, active) {
        const turbine = elements.turbine;

        if (!turbine) return;

        if (!active || rpm <= 0) {
            turbine.classList.remove("is-spinning");
            turbine.style.removeProperty("--spin-duration");
            return;
        }

        // Uma volta a cada 60 / RPM segundos.
        const duration = clamp(60 / rpm, 0.08, 2.5);

        turbine.style.setProperty(
            "--spin-duration",
            `${duration}s`
        );

        turbine.classList.add("is-spinning");
    }

    /* ---------- 8. ATUALIZAÇÃO DOS INDICADORES ---------- */

    function updateDisplays() {
        const input = getInputs();
        const real = isRealVoltage(input.voltage);
        const fault = isOvervoltage(input.voltage);

        const theoreticalPower = calculateTheoreticalPower(
            input.wind,
            input.area,
            input.efficiency
        );

        const rpm = computeRpm(input.wind, input.voltage);
        const rotating = state.running && !fault && rpm > 0;
        const shownRpm = state.running && !fault ? rpm : 0;

        // Em falha simulada, a geração considerada é interrompida.
        state.estimatedPower = fault
            ? 0
            : applyNominalLimit(theoreticalPower);

        setText(elements.voltageValue, formatNumber(input.voltage, 1));
        setText(elements.voltageData, `${formatNumber(input.voltage, 1)} V`);

        const voltageLabel = real ? "DADO REAL DO PROTÓTIPO" : "VALOR SIMULADO";
        setText(elements.voltageTag, voltageLabel);
        setText(elements.voltageDataTag, voltageLabel);
        markTag(elements.voltageTag, real);
        markTag(elements.voltageDataTag, real);

        setText(
            elements.windValue,
            formatNumber(input.wind, 1)
        );

        setText(
            elements.areaValue,
            String(input.area)
        );

        setText(
            elements.efficiencyValue,
            String(Math.round(input.efficiency * 100))
        );

        setText(
            elements.timeValue,
            String(input.durationMinutes)
        );

        setText(
            elements.speedData,
            `${formatNumber(input.wind, 1)} m/s`
        );

        setText(
            elements.rpmData,
            `${formatNumber(shownRpm, 0)} RPM`
        );

        setText(
            elements.areaData,
            `${formatNumber(input.area, 0)} m²`
        );

        setText(
            elements.theoreticalPowerData,
            formatPower(theoreticalPower)
        );

        setText(
            elements.powerData,
            formatPower(state.estimatedPower)
        );

        if (elements.powerLimitNote) {
            elements.powerLimitNote.hidden = !(theoreticalPower > TURBINE.ratedPower && !fault);
        }

        if (state.accumulatedEnergyWh >= 1000) {
            setText(
                elements.energyData,
                `${formatNumber(state.accumulatedEnergyWh / 1000, 3)} kWh`
            );
        } else {
            setText(
                elements.energyData,
                `${formatNumber(state.accumulatedEnergyWh, 3)} Wh`
            );
        }

        setText(
            elements.efficiencyData,
            `${Math.round(input.efficiency * 100)} %`
        );

        setText(
            elements.timeData,
            `${input.durationMinutes} min`
        );

        setText(
            elements.windStateData,
            getWindDescription(input.wind)
        );

        if (elements.faultBanner) {
            elements.faultBanner.hidden = !fault;
        }

        if (elements.turbineArea) {
            elements.turbineArea.classList.toggle("is-running", state.running);
            elements.turbineArea.classList.toggle("is-fault", fault);
        }

        if (fault) {
            setText(elements.systemState, "SOBRETENSÃO — FALHA SIMULADA");
        } else if (state.finished) {
            setText(elements.systemState, "CONCLUÍDO");
        } else if (state.running) {
            setText(elements.systemState, "EM EXECUÇÃO");
        } else {
            setText(elements.systemState, "PARADO");
        }

        if (elements.returnRealButton) {
            elements.returnRealButton.disabled = state.running || real;
        }

        updateRotor(rpm, rotating);
    }

    /* ---------- 8B. BLOQUEIO DOS CONTROLES ---------- */

    function setControlsLocked(locked) {
        CONTROL_INPUTS.forEach(input => {
            input.disabled = locked;
        });

        if (elements.controlPanel) {
            elements.controlPanel.classList.toggle("is-locked", locked);
        }

        if (elements.lockNotice) {
            elements.lockNotice.hidden = !locked;
        }
    }

    /* ---------- 9. JANELA DE CONCLUSÃO ---------- */

    function setModalOpen(open) {
        const modal = elements.completionModal;

        if (!modal) return;

        // O atributo hidden precisa ser removido para a janela aparecer.
        modal.hidden = !open;
        modal.classList.toggle("is-open", open);
        modal.setAttribute("aria-hidden", String(!open));
    }

    function finishSimulation() {
        state.running = false;
        state.finished = true;
        state.animationFrame = null;

        setControlsLocked(false);
        updateDisplays();

        const input = getInputs();

        setText(
            elements.modalTime,
            formatElapsed(state.elapsedSeconds)
        );

        setText(
            elements.modalEfficiency,
            `${Math.round(input.efficiency * 100)} %`
        );

        setText(
            elements.modalPauses,
            formatElapsed(state.pausedSeconds)
        );

        setModalOpen(true);
    }

    /* ---------- 10. CICLO DA SIMULAÇÃO ---------- */

    function simulationLoop(timestamp) {
        if (!state.running) {
            state.animationFrame = null;
            return;
        }

        if (state.lastTimestamp !== null) {
            const delta = Math.max(
                0,
                (timestamp - state.lastTimestamp) / 1000
            );

            // Evita saltos grandes se a aba ficar suspensa.
            const safeDelta = Math.min(delta, 1);

            // Não ultrapassa a duração escolhida no último quadro.
            const remaining = Math.max(
                0,
                getInputs().durationMinutes * 60 - state.elapsedSeconds
            );
            const step = Math.min(safeDelta, remaining);

            state.elapsedSeconds += step;

            state.accumulatedEnergyWh +=
                state.estimatedPower *
                (step / 3600);
        }

        state.lastTimestamp = timestamp;

        updateDisplays();

        const durationSeconds =
            getInputs().durationMinutes * 60;

        if (state.elapsedSeconds >= durationSeconds) {
            state.elapsedSeconds = durationSeconds;
            finishSimulation();
            return;
        }

        state.animationFrame =
            requestAnimationFrame(simulationLoop);
    }

    /* ---------- 11. INICIAR SIMULAÇÃO ---------- */

    function startSimulation() {
        if (state.running || state.finished) return;

        state.running = true;
        state.lastTimestamp = null;

        setControlsLocked(true);
        updateDisplays();

        state.animationFrame =
            requestAnimationFrame(simulationLoop);
    }

    /* ---------- 12. RESETAR SIMULAÇÃO ---------- */

    function resetSimulation() {
        if (state.animationFrame !== null) {
            cancelAnimationFrame(state.animationFrame);
            state.animationFrame = null;
        }

        state.running = false;
        state.finished = false;
        state.lastTimestamp = null;
        state.elapsedSeconds = 0;
        state.pausedSeconds = 0;
        state.hiddenAt = null;
        state.accumulatedEnergyWh = 0;
        state.estimatedPower = 0;

        // Restaura os valores iniciais definidos em DEFAULTS.
        if (elements.voltage) {
            elements.voltage.value = String(DEFAULTS.voltage);
        }

        if (elements.windSpeed) {
            elements.windSpeed.value = String(DEFAULTS.wind);
        }

        if (elements.rotorArea) {
            elements.rotorArea.value = String(DEFAULTS.area);
        }

        if (elements.efficiency) {
            elements.efficiency.value = String(DEFAULTS.efficiency);
        }

        if (elements.simulationTime) {
            elements.simulationTime.value = String(DEFAULTS.durationMinutes);
        }

        setControlsLocked(false);
        setModalOpen(false);
        updateDisplays();
    }

    /* ---------- 12B. VOLTAR À CONDIÇÃO REAL ---------- */

    function returnToRealCondition() {
        if (state.running) return;

        if (elements.voltage) {
            elements.voltage.value = String(VOLTAGE.real);
        }

        updateDisplays();
    }

    /* ---------- 13. EVENTOS DOS CONTROLES ---------- */

    CONTROL_INPUTS.forEach(input => {
        input.addEventListener("input", updateDisplays);
    });

    elements.startButton?.addEventListener(
        "click",
        startSimulation
    );

    elements.resetButton?.addEventListener(
        "click",
        resetSimulation
    );

    elements.returnRealButton?.addEventListener(
        "click",
        returnToRealCondition
    );

    elements.closeModal?.addEventListener(
        "click",
        () => setModalOpen(false)
    );

    elements.completionModal?.addEventListener(
        "click",
        event => {
            if (event.target === elements.completionModal) {
                setModalOpen(false);
            }
        }
    );

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            setModalOpen(false);
        }
    });

    /* ---------- 14. VISIBILIDADE DA ABA ---------- */

    document.addEventListener("visibilitychange", () => {
        if (document.hidden && state.running) {
            state.hiddenAt = performance.now();
            state.lastTimestamp = null;
        } else if (!document.hidden && state.hiddenAt !== null) {
            state.pausedSeconds += Math.max(
                0,
                (performance.now() - state.hiddenAt) / 1000
            );

            state.hiddenAt = null;
            state.lastTimestamp = null;
        }
    });

    /* ---------- 15. INICIALIZAÇÃO ---------- */

    // Atualiza os indicadores sem iniciar o temporizador.
    updateDisplays();
    setModalOpen(false);})();
