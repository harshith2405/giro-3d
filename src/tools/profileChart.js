// src/tools/profileChart.js
// Chart.js 2D Profile Curves, Interactive Click-to-Pin Guideline, and Pinned Radar Markers

import Chart from "chart.js/auto";
import { state } from "../core/state.js";

// Custom chart background plugin for clean export
const customBgPlugin = {
  id: 'customCanvasBackgroundColor',
  beforeDraw: (chart, args, options) => {
    const { ctx } = chart;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = options.color || '#ffffff';
    ctx.fillRect(0, 0, chart.width, chart.height);
    ctx.restore();
  }
};

// Pinned vertical guideline & glowing station halo plugin
const pinnedIndicatorPlugin = {
  id: 'pinnedProfileStationLine',
  afterDatasetsDraw: (chart) => {
    if (state.currentProfilePinnedIndex == null) return;
    const meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data || !meta.data[state.currentProfilePinnedIndex]) return;
    const point = meta.data[state.currentProfilePinnedIndex];
    const ctx = chart.ctx;
    ctx.save();

    // 1. Draw vertical dashed purple guideline
    ctx.beginPath();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 1.6;
    ctx.moveTo(point.x, chart.chartArea.top);
    ctx.lineTo(point.x, chart.chartArea.bottom);
    ctx.stroke();

    // 2. Outer glowing halo
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(point.x, point.y, 8.5, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(124, 58, 237, 0.28)';
    ctx.fill();

    // 3. Pinned core dot
    ctx.beginPath();
    ctx.arc(point.x, point.y, 5.5, 0, 2 * Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#7c3aed';
    ctx.stroke();
    ctx.restore();
  }
};

export function initCharts() {
  const miniCanvas = document.getElementById("elevationMiniChart");
  const fullCanvas = document.getElementById("elevationFullChart");

  if (miniCanvas && !state.miniChart) {
    const miniCtx = miniCanvas.getContext("2d");
    if (miniCtx) {
      state.miniChart = new Chart(miniCtx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            data: [],
            borderColor: '#5e19ea',
            backgroundColor: 'rgba(94, 25, 234, 0.12)',
            fill: true,
            tension: 0.2,
            borderWidth: 2,
            pointRadius: (ctx) => {
              const index = ctx.dataIndex;
              const count = ctx.dataset?.data?.length || 0;
              if (count <= 1) return 4;
              if (index === 0 || index === count - 1) return 5.5;
              return 0;
            },
            pointBackgroundColor: (ctx) => {
              const index = ctx.dataIndex;
              const count = ctx.dataset?.data?.length || 0;
              if (index === 0) return '#10b981';
              if (index === count - 1) return '#ef4444';
              return '#5e19ea';
            },
            pointBorderColor: '#ffffff',
            pointBorderWidth: 1.8,
            pointHoverRadius: 7
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { display: false },
            y: {
              display: true,
              ticks: { color: '#64748b', font: { size: 9 } },
              grid: { color: 'rgba(226, 232, 240, 0.8)' },
              grace: '5%'
            }
          },
          onClick: (event, activeElements) => {
            if (activeElements && activeElements.length > 0) {
              if (typeof window.pinProfile3DPoint === "function") {
                window.pinProfile3DPoint(activeElements[0].index);
              }
            }
          },
          onHover: (event, activeElements) => {
            if (activeElements && activeElements.length > 0) {
              if (typeof window.showProfile3DHoverPoint === "function") {
                window.showProfile3DHoverPoint(activeElements[0].index);
              }
            } else {
              if (typeof window.hideProfile3DHoverPoint === "function") {
                window.hideProfile3DHoverPoint();
              }
            }
          }
        },
        plugins: [pinnedIndicatorPlugin]
      });

      miniCanvas.addEventListener("mouseleave", () => {
        if (typeof window.hideProfile3DHoverPoint === "function") window.hideProfile3DHoverPoint();
      });
    }
  }

  if (fullCanvas && !state.fullChart) {
    const fullCtx = fullCanvas.getContext("2d");
    if (fullCtx) {
      state.fullChart = new Chart(fullCtx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'Elevation',
            data: [],
            borderColor: '#5e19ea',
            backgroundColor: 'rgba(94, 25, 234, 0.12)',
            fill: true,
            tension: 0.25,
            borderWidth: 2.2,
            pointRadius: (ctx) => {
              const index = ctx.dataIndex;
              const count = ctx.dataset?.data?.length || 0;
              if (count <= 1) return 6;
              if (index === 0 || index === count - 1) return 6.5;
              return 0;
            },
            pointBackgroundColor: (ctx) => {
              const index = ctx.dataIndex;
              const count = ctx.dataset?.data?.length || 0;
              if (index === 0) return '#10b981';
              if (index === count - 1) return '#ef4444';
              return '#5e19ea';
            },
            pointBorderColor: '#ffffff',
            pointBorderWidth: (ctx) => {
              const index = ctx.dataIndex;
              const count = ctx.dataset?.data?.length || 0;
              if (index === 0 || index === count - 1) return 2.2;
              return 0;
            },
            pointHoverRadius: (ctx) => {
              const index = ctx.dataIndex;
              const count = ctx.dataset?.data?.length || 0;
              if (index === 0 || index === count - 1) return 9;
              return 6;
            },
            pointHoverBackgroundColor: (ctx) => {
              const index = ctx.dataIndex;
              const count = ctx.dataset?.data?.length || 0;
              if (index === 0) return '#059669';
              if (index === count - 1) return '#dc2626';
              return '#5e19ea';
            }
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#0f172a',
              titleColor: '#f8fafc',
              bodyColor: '#c4b5fd',
              borderColor: '#7c3aed',
              borderWidth: 1,
              padding: 10,
              displayColors: false,
              callbacks: {
                title: (items) => {
                  if (!items || items.length === 0) return '';
                  const idx = items[0].dataIndex;
                  const total = items[0].dataset?.data?.length || 0;
                  if (idx === 0) return `🟢 START POINT (0.0 m)`;
                  if (idx === total - 1) return `🔴 END POINT (${items[0].label} m)`;
                  return `Distance: ${items[0].label} m`;
                },
                label: (ctx) => `Elevation: ${ctx.parsed.y.toFixed(2)} m`
              }
            }
          },
          scales: {
            x: {
              title: { display: true, text: 'Distance (m)', color: '#334155', font: { weight: '600' } },
              ticks: {
                color: '#64748b',
                maxTicksLimit: 10,
                maxRotation: 0,
                minRotation: 0,
                autoSkip: true,
                callback: function(val) {
                  const label = this.getLabelForValue(val);
                  return label != null ? `${parseFloat(label).toFixed(0)}m` : '';
                }
              },
              grid: { color: '#e2e8f0' }
            },
            y: {
              title: { display: true, text: 'Elevation (m)', color: '#334155', font: { weight: '600' } },
              ticks: { color: '#64748b' },
              grid: { color: '#e2e8f0' },
              grace: '5%'
            }
          },
          onClick: (event, activeElements) => {
            if (activeElements && activeElements.length > 0) {
              if (typeof window.pinProfile3DPoint === "function") {
                window.pinProfile3DPoint(activeElements[0].index);
              }
            }
          },
          onHover: (event, activeElements) => {
            if (activeElements && activeElements.length > 0) {
              if (typeof window.showProfile3DHoverPoint === "function") {
                window.showProfile3DHoverPoint(activeElements[0].index);
              }
            } else {
              if (typeof window.hideProfile3DHoverPoint === "function") {
                window.hideProfile3DHoverPoint();
              }
            }
          }
        },
        plugins: [customBgPlugin, pinnedIndicatorPlugin]
      });

      fullCanvas.addEventListener("mouseleave", () => {
        if (typeof window.hideProfile3DHoverPoint === "function") window.hideProfile3DHoverPoint();
      });
    }
  }

  // Attach comparison dataset if present
  if (state.currentProfileComparisonData) {
    if (state.miniChart) {
      if (state.miniChart.data.datasets.length < 2) {
        state.miniChart.data.datasets.push({
          label: `Past (${state.currentProfileComparisonData.label})`,
          data: state.currentProfileComparisonData.pastElevs,
          borderColor: '#ea580c',
          borderDash: [5, 4],
          fill: false,
          tension: 0.25,
          borderWidth: 2,
          pointRadius: 0
        });
      } else {
        state.miniChart.data.datasets[1].data = state.currentProfileComparisonData.pastElevs;
        state.miniChart.data.datasets[1].label = `Past (${state.currentProfileComparisonData.label})`;
      }
    }
    if (state.fullChart) {
      if (state.fullChart.data.datasets.length < 2) {
        state.fullChart.data.datasets.push({
          label: `Past (${state.currentProfileComparisonData.label})`,
          data: state.currentProfileComparisonData.pastElevs,
          borderColor: '#ea580c',
          borderDash: [6, 4],
          fill: false,
          tension: 0.25,
          borderWidth: 2.2,
          pointRadius: (ctx) => {
            const index = ctx.dataIndex;
            const count = ctx.dataset?.data?.length || 0;
            if (index === 0 || index === count - 1) return 5.5;
            return 0;
          },
          pointBackgroundColor: '#ea580c',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.5,
          pointHoverRadius: 6
        });
      } else {
        state.fullChart.data.datasets[1].data = state.currentProfileComparisonData.pastElevs;
        state.fullChart.data.datasets[1].label = `Past (${state.currentProfileComparisonData.label})`;
      }
      if (state.fullChart.options && state.fullChart.options.plugins) {
        state.fullChart.options.plugins.legend = {
          display: true,
          position: 'top',
          labels: { color: '#334155', font: { size: 11, weight: '600' } }
        };
      }
    }
  } else {
    if (state.miniChart && state.miniChart.data.datasets.length > 1) {
      state.miniChart.data.datasets.splice(1, 1);
      try { state.miniChart.update("none"); } catch (e) {}
    }
    if (state.fullChart && state.fullChart.data.datasets.length > 1) {
      state.fullChart.data.datasets.splice(1, 1);
      if (state.fullChart.options && state.fullChart.options.plugins && state.fullChart.options.plugins.legend) {
        state.fullChart.options.plugins.legend.display = false;
      }
      try { state.fullChart.update(); } catch (e) {}
    }
  }
}

window.initCharts = initCharts;
