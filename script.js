document.addEventListener('DOMContentLoaded', () => {
    const API_BASE_URL = 'https://api.coingecko.com/api/v3';

    const dom = {
        filterInput: document.getElementById('filterInput'),
        currencySelector: document.getElementById('currencySelector'),
        tableContainer: document.getElementById('table-container'),
        loader: document.getElementById('loader'),
        errorMessage: document.getElementById('error-message'),
        paginationControls: document.getElementById('pagination-controls'),
        priceChartCanvas: document.getElementById('priceChart').getContext('2d'),
        chartTitle: document.getElementById('chart-title'),
        chartHelper: document.getElementById('chart-helper'),
        chartLoader: document.getElementById('chart-loader'),
        chartPeriodSelector: document.getElementById('chart-period-selector'),
        coinModal: document.getElementById('coin-modal'),
        modalContent: document.getElementById('modal-content'),
        scrollToTrackerBtn: document.getElementById('scrollToTrackerBtn'),
    };

    const state = {
        allCoins: [],
        currentPage: 1,
        coinsPerPage: 20,
        currentCurrency: 'usd',
        selectedCoin: null,
        selectedChartDays: 30,
        priceChart: null,
        currencyFormatter: null,
        marketCapFormatter: null,
    };

    function setupFormatters() {
        state.currencyFormatter = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: state.currentCurrency.toUpperCase(),
            minimumFractionDigits: 2,
            maximumFractionDigits: 6,
        });
        state.marketCapFormatter = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: state.currentCurrency.toUpperCase(),
            notation: 'compact',
            compactDisplay: 'long'
        });
    }

    async function fetchWithRetry(url, options, retries = 3, backoff = 1000) {
        for (let i = 0; i < retries; i++) {
            try {
                const response = await fetch(url, options);
                if (!response.ok && response.status !== 429 && response.status < 500) {
                     return response;
                }
                if (!response.ok) {
                    throw new Error(`API Error with status ${response.status}`);
                }
                return response;
            } catch (error) {
                if (i === retries - 1) throw error;
                await new Promise(resolve => setTimeout(resolve, backoff));
                backoff *= 2;
            }
        }
    }

    async function fetchCoinData() {
        showLoader(true);
        try {
            const response = await fetchWithRetry(`${API_BASE_URL}/coins/markets?vs_currency=${state.currentCurrency}&order=market_cap_desc&per_page=100&page=1&sparkline=false`);
            if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
            state.allCoins = await response.json();
            render();
        } catch (error) {
            showError('Не удалось загрузить данные. Пожалуйста, попробуйте обновить страницу позже.');
        } finally {
            showLoader(false);
        }
    }

    async function fetchChartData() {
        if (!state.selectedCoin) return;
        dom.chartLoader.classList.remove('hidden');
        if (state.priceChart) state.priceChart.destroy();
        try {
            const url = `${API_BASE_URL}/coins/${state.selectedCoin.id}/market_chart?vs_currency=${state.currentCurrency}&days=${state.selectedChartDays}`;
            const response = await fetchWithRetry(url);
            if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
            const chartData = await response.json();
            renderChart(chartData);
        } catch (error) {
            dom.chartTitle.textContent = 'Ошибка загрузки графика';
        } finally {
            dom.chartLoader.classList.add('hidden');
        }
    }
    
    async function fetchCoinDetails(coinId) {
        showModalLoader();
        try {
            const url = `${API_BASE_URL}/coins/${coinId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`;
            const response = await fetchWithRetry(url);
            if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
            const details = await response.json();
            renderModalContent(details);
        } catch (error) {
            dom.modalContent.innerHTML = `<div class="p-8 text-center text-red-400">Не удалось загрузить детали.</div>`;
        }
    }

    function render() {
        const searchTerm = dom.filterInput.value.toLowerCase();
        const filteredCoins = state.allCoins.filter(c => c.name.toLowerCase().includes(searchTerm) || c.symbol.toLowerCase().includes(searchTerm));
        
        const paginatedCoins = filteredCoins.slice(
            (state.currentPage - 1) * state.coinsPerPage,
            state.currentPage * state.coinsPerPage
        );

        renderTable(paginatedCoins);
        renderPaginationControls(filteredCoins.length);
    }

    function renderTable(coins) {
        if (coins.length === 0) {
            dom.tableContainer.innerHTML = `<p class="text-center p-8 text-gray-400">Ничего не найдено.</p>`;
            return;
        }
        const tableHeader = `<thead class="bg-gray-900/50 text-xs text-gray-400 uppercase tracking-wider"><tr><th class="p-4 text-left">#</th><th class="p-4 text-left">Монета</th><th class="p-4 text-right">Цена</th><th class="p-4 text-right">24ч %</th><th class="p-4 text-right hidden sm:table-cell">Рыночная кап.</th></tr></thead>`;
        const tableBody = coins.map(coin => {
            const priceChange = coin.price_change_percentage_24h;
            const priceChangeColor = priceChange >= 0 ? 'text-green-400' : 'text-red-400';
            return `
                <tr class="border-b border-gray-700/50 cursor-pointer table-row-hover" data-coin-id="${coin.id}" data-coin-name="${coin.name}">
                    <td class="p-4 text-gray-400">${coin.market_cap_rank}</td>
                    <td class="p-4"><div class="flex items-center"><img src="${coin.image}" alt="${coin.name}" class="w-8 h-8 mr-4 rounded-full"><div class="flex-1"><p class="font-semibold text-white text-base">${coin.name}</p><p class="text-sm text-gray-400 uppercase">${coin.symbol}</p></div></div></td>
                    <td class="p-4 text-right font-semibold text-white">${state.currencyFormatter.format(coin.current_price)}</td>
                    <td class="p-4 text-right font-semibold ${priceChangeColor}">${priceChange ? priceChange.toFixed(2) : '0'}%</td>
                    <td class="p-4 text-right hidden sm:table-cell text-gray-300">${state.marketCapFormatter.format(coin.market_cap)}</td>
                </tr>`;
        }).join('');
        dom.tableContainer.innerHTML = `<table class="w-full"> ${tableHeader} <tbody>${tableBody}</tbody> </table>`;
    }

    function renderPaginationControls(totalItems) {
        const totalPages = Math.ceil(totalItems / state.coinsPerPage);
        dom.paginationControls.innerHTML = '';
        if (totalPages <= 1) return;

        const prevDisabled = state.currentPage === 1 ? 'opacity-50 cursor-not-allowed' : '';
        const nextDisabled = state.currentPage === totalPages ? 'opacity-50 cursor-not-allowed' : '';

        dom.paginationControls.innerHTML = `
            <button data-action="prev" class="px-4 py-2 text-sm rounded-md bg-gray-700 hover:bg-gray-600 transition ${prevDisabled}">Назад</button>
            <span class="text-gray-400 text-sm">Стр. ${state.currentPage} из ${totalPages}</span>
            <button data-action="next" class="px-4 py-2 text-sm rounded-md bg-gray-700 hover:bg-gray-600 transition ${nextDisabled}">Вперед</button>
        `;
    }

    function renderChart(data) {
        dom.chartHelper.classList.add('hidden');
        dom.chartTitle.textContent = `График: ${state.selectedCoin.name}`;
        const labels = data.prices.map(p => new Date(p[0]).toLocaleDateString());
        const prices = data.prices.map(p => p[1]);
        const borderColor = prices[0] <= prices[prices.length - 1] ? 'rgba(74, 222, 128, 1)' : 'rgba(248, 113, 113, 1)';
        const backgroundColor = prices[0] <= prices[prices.length - 1] ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.1)';
        
        state.priceChart = new Chart(dom.priceChartCanvas, {
            type: 'line',
            data: { labels, datasets: [{ label: `Цена`, data: prices, borderColor, backgroundColor, borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true }] },
            options: {
                responsive: true, maintainAspectRatio: true,
                plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false, callbacks: { label: c => `Цена: ${state.currencyFormatter.format(c.parsed.y)}` } } },
                scales: {
                    x: { display: true, ticks: { color: '#9CA3AF', maxRotation: 0, autoSkip: true, maxTicksLimit: 7 }, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
                    y: { display: true, ticks: { color: '#9CA3AF', callback: v => state.currencyFormatter.format(v).replace(/\.00$/, '') }, grid: { color: 'rgba(255, 255, 255, 0.05)' } }
                }
            }
        });
    }
    
    function renderModalContent(details) {
        const data = details.market_data;
        const priceChange24h = data.price_change_percentage_24h_in_currency[state.currentCurrency];
        const priceChangeColor = priceChange24h >= 0 ? 'text-green-400' : 'text-red-400';
        
        dom.modalContent.innerHTML = `
            <div class="p-6">
                <div class="flex justify-between items-start">
                    <div class="flex items-center gap-4">
                        <img src="${details.image.large}" class="w-16 h-16 rounded-full">
                        <div>
                            <h2 class="text-3xl font-bold text-white">${details.name} <span class="text-xl text-gray-400 uppercase">${details.symbol}</span></h2>
                            <p class="text-gray-300">Ранг #${details.market_cap_rank}</p>
                        </div>
                    </div>
                    <button data-action="close-modal" class="text-gray-400 hover:text-white text-3xl">&times;</button>
                </div>
                <div class="my-6">
                    <p class="text-4xl font-bold text-white">${state.currencyFormatter.format(data.current_price[state.currentCurrency])} 
                        <span class="text-xl font-semibold ml-2 ${priceChangeColor}">${priceChange24h.toFixed(2)}%</span>
                    </p>
                </div>
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                    <div class="bg-gray-900/50 p-3 rounded-lg"><p class="text-gray-400">Рыночная кап.</p><p class="font-semibold text-white text-base">${state.marketCapFormatter.format(data.market_cap[state.currentCurrency])}</p></div>
                    <div class="bg-gray-900/50 p-3 rounded-lg"><p class="text-gray-400">Объем (24ч)</p><p class="font-semibold text-white text-base">${state.marketCapFormatter.format(data.total_volume[state.currentCurrency])}</p></div>
                    <div class="bg-gray-900/50 p-3 rounded-lg"><p class="text-gray-400">Макс. (24ч)</p><p class="font-semibold text-white text-base">${state.currencyFormatter.format(data.high_24h[state.currentCurrency])}</p></div>
                    <div class="bg-gray-900/50 p-3 rounded-lg"><p class="text-gray-400">Мин. (24ч)</p><p class="font-semibold text-white text-base">${state.currencyFormatter.format(data.low_24h[state.currentCurrency])}</p></div>
                    <div class="bg-gray-900/50 p-3 rounded-lg"><p class="text-gray-400">В обращении</p><p class="font-semibold text-white text-base">${Number(data.circulating_supply).toLocaleString()}</p></div>
                    <div class="bg-gray-900/50 p-3 rounded-lg"><p class="text-gray-400">Всего эмиссия</p><p class="font-semibold text-white text-base">${data.total_supply ? Number(data.total_supply).toLocaleString() : '∞'}</p></div>
                </div>
                <div class="mt-6 text-gray-300 text-sm prose prose-invert max-w-none">${details.description.ru || details.description.en.split('. ').slice(0, 2).join('. ') + '.'}</div>
            </div>
        `;
    }

    function handleFilter() {
        state.currentPage = 1;
        render();
    }

    function handleCurrencyChange(event) {
        state.currentCurrency = event.target.value;
        state.currentPage = 1;
        setupFormatters();
        fetchCoinData();
        if (state.selectedCoin) fetchChartData();
    }

    function handleChartPeriodChange(event) {
        const button = event.target.closest('button');
        if (button) {
            state.selectedChartDays = parseInt(button.dataset.days, 10);
            dom.chartPeriodSelector.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            fetchChartData();
        }
    }

    function handleRowClick(event) {
        const row = event.target.closest('tr[data-coin-id]');
        if (!row) return;

        const { coinId, coinName } = row.dataset;
        state.selectedCoin = { id: coinId, name: coinName };
        
        if (state.priceChart) state.priceChart.destroy();
        dom.chartTitle.textContent = `График: ${coinName}`;
        dom.chartHelper.classList.add('hidden');

        fetchChartData();
        fetchCoinDetails(coinId);
        openModal();
    }
    
    function handlePaginationClick(event) {
        const button = event.target.closest('button');
        if (!button) return;

        const action = button.dataset.action;
        const totalPages = Math.ceil(state.allCoins.length / state.coinsPerPage);

        if (action === 'prev' && state.currentPage > 1) {
            state.currentPage--;
            render();
        }
        if (action === 'next' && state.currentPage < totalPages) {
            state.currentPage++;
            render();
        }
    }

    function showLoader(isLoading) {
        dom.loader.style.display = isLoading ? 'flex' : 'none';
        dom.tableContainer.style.display = isLoading ? 'none' : 'block';
        dom.paginationControls.style.display = isLoading ? 'none' : 'flex';
        if (isLoading) dom.errorMessage.classList.add('hidden');
    }

    function showError(message) {
        dom.errorMessage.textContent = message;
        dom.errorMessage.classList.remove('hidden');
    }

    function openModal() {
        dom.coinModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        setTimeout(() => {
            dom.coinModal.classList.remove('opacity-0');
            dom.modalContent.classList.remove('scale-95');
        }, 10);
    }

    function closeModal() {
        dom.coinModal.classList.add('opacity-0');
        dom.modalContent.classList.add('scale-95');
        document.body.style.overflow = '';
        setTimeout(() => dom.coinModal.classList.add('hidden'), 300);
    }
    
    function showModalLoader() {
        dom.modalContent.innerHTML = `<div class="flex justify-center items-center h-96"><div class="loader"></div></div>`;
    }
    
    function setupEventListeners() {
        dom.scrollToTrackerBtn.addEventListener('click', () => document.getElementById('tracker').scrollIntoView({ behavior: 'smooth' }));
        dom.filterInput.addEventListener('input', handleFilter);
        dom.currencySelector.addEventListener('change', handleCurrencyChange);
        dom.chartPeriodSelector.addEventListener('click', handleChartPeriodChange);
        dom.tableContainer.addEventListener('click', handleRowClick);
        dom.paginationControls.addEventListener('click', handlePaginationClick);
        dom.coinModal.addEventListener('click', (e) => {
            if (e.target === dom.coinModal || e.target.closest('[data-action="close-modal"]')) {
                closeModal();
            }
        });
    }

    initPlexusBackground();
    setupFormatters();
    fetchCoinData();
    setupEventListeners();
});

function initPlexusBackground() {
    let scene, camera, renderer, particles, lineMesh;
    let mouse = new THREE.Vector2(-100, -100);
    const PARTICLE_COUNT = 150;
    const MAX_DISTANCE = 80;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 150;

    renderer = new THREE.WebGLRenderer({
        canvas: document.getElementById('bg-canvas'),
        alpha: true
    });
    renderer.setSize(window.innerWidth, window.innerHeight);

    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const velocities = [];

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        positions[i * 3] = (Math.random() - 0.5) * window.innerWidth * 0.5;
        positions[i * 3 + 1] = (Math.random() - 0.5) * window.innerHeight * 0.5;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 100;

        velocities.push({
            x: (Math.random() - 0.5) * 0.2,
            y: (Math.random() - 0.5) * 0.2,
        });
    }

    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particleGeometry.velocities = velocities;

    const particleMaterial = new THREE.PointsMaterial({
        color: 0x4A90E2,
        size: 2,
        transparent: true,
        blending: THREE.AdditiveBlending
    });

    particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);

    const lineGeometry = new THREE.BufferGeometry();
    const linePositions = new Float32Array(PARTICLE_COUNT * PARTICLE_COUNT * 3);
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));

    const lineMaterial = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.1
    });

    lineMesh = new THREE.LineSegments(lineGeometry, lineMaterial);
    scene.add(lineMesh);

    window.addEventListener('resize', onWindowResize, false);
    document.addEventListener('mousemove', onMouseMove, false);
    animate();

    function onWindowResize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
    
    function onMouseMove(event) {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    }

    function animate() {
        requestAnimationFrame(animate);

        const positions = particles.geometry.attributes.position.array;
        const velocities = particles.geometry.velocities;
        const linePositions = lineMesh.geometry.attributes.position.array;
        let lineVertexIndex = 0;

        const mouse3D = new THREE.Vector3(
            (mouse.x * window.innerWidth) / 5, 
            (mouse.y * window.innerHeight) / 5, 
            0
        );

        for (let i = 0; i < PARTICLE_COUNT; i++) {
            positions[i * 3] += velocities[i].x;
            positions[i * 3 + 1] += velocities[i].y;

            const p = new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
            const distanceToMouse = p.distanceTo(mouse3D);
            if (distanceToMouse < 100) {
                const direction = p.sub(mouse3D).normalize();
                positions[i * 3] += direction.x * 0.5;
                positions[i * 3 + 1] += direction.y * 0.5;
            }

            if (Math.abs(positions[i * 3]) > window.innerWidth / 2) velocities[i].x *= -1;
            if (Math.abs(positions[i * 3 + 1]) > window.innerHeight / 2) velocities[i].y *= -1;

            for (let j = i + 1; j < PARTICLE_COUNT; j++) {
                const dx = positions[i * 3] - positions[j * 3];
                const dy = positions[i * 3 + 1] - positions[j * 3 + 1];
                const dz = positions[i * 3 + 2] - positions[j * 3 + 2];
                const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

                if (distance < MAX_DISTANCE) {
                    linePositions[lineVertexIndex++] = positions[i * 3];
                    linePositions[lineVertexIndex++] = positions[i * 3 + 1];
                    linePositions[lineVertexIndex++] = positions[i * 3 + 2];
                    linePositions[lineVertexIndex++] = positions[j * 3];
                    linePositions[lineVertexIndex++] = positions[j * 3 + 1];
                    linePositions[lineVertexIndex++] = positions[j * 3 + 2];
                }
            }
        }
        
        lineMesh.geometry.setDrawRange(0, lineVertexIndex / 3);
        lineMesh.geometry.attributes.position.needsUpdate = true;
        particles.geometry.attributes.position.needsUpdate = true;
        
        renderer.render(scene, camera);
    }
}
