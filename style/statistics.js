// Statistics Dashboard JavaScript

let charts = {};

// Load statistics when page loads
document.addEventListener('DOMContentLoaded', () => {
    loadStatistics();
});

function scrollToSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

async function loadStatistics() {
    const loadingEl = document.getElementById('loading');
    const contentEl = document.getElementById('statistics-content');
    const errorContainer = document.getElementById('error-container');

    loadingEl.style.display = 'flex';
    contentEl.style.display = 'none';
    errorContainer.innerHTML = '';

    try {
        const response = await fetch('/api/statistics');
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Failed to load statistics');
        }

        const data = result.data;

        // Update overview cards
        updateOverviewCards(data.returnStats);

        // Render charts
        renderMostBorrowedChart(data.mostBorrowed);
        renderUtilizationTable(data.equipmentStatus);
        renderDurationChart(data.durationStats);
        renderTopBorrowersTable(data.topBorrowers);
        renderTeamChart(data.teamStats);
        renderReturnStatusChart(data.returnStats);
        renderMonthlyTrendsChart(data.monthlyStats);
        renderRecentActivityChart(data.borrowingTrends);

        loadingEl.style.display = 'none';
        contentEl.style.display = 'block';
    } catch (error) {
        console.error('Error loading statistics:', error);
        loadingEl.style.display = 'none';
        errorContainer.innerHTML = `
            <div class="error-message">
                <strong>Error:</strong> ${error.message}
            </div>
        `;
    }
}

function updateOverviewCards(stats) {
    document.getElementById('total-issued').textContent = stats.totalIssued || 0;
    document.getElementById('total-returned').textContent = stats.totalReturned || 0;
    document.getElementById('total-pending').textContent = stats.totalPending || 0;
    document.getElementById('total-overdue').textContent = stats.totalOverdue || 0;
    document.getElementById('total-damaged').textContent = stats.totalDamaged || 0;
    
    const returnRate = stats.totalIssued > 0 
        ? ((stats.totalReturned / stats.totalIssued) * 100).toFixed(1)
        : 0;
    document.getElementById('return-rate').textContent = returnRate + '%';
}

function renderMostBorrowedChart(data) {
    const ctx = document.getElementById('most-borrowed-chart');
    
    // Destroy existing chart if it exists
    if (charts.mostBorrowed) {
        charts.mostBorrowed.destroy();
    }

    charts.mostBorrowed = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(item => item.equipmentBorrowed),
            datasets: [{
                label: 'Times Borrowed',
                data: data.map(item => item.borrowCount),
                backgroundColor: 'rgba(196, 18, 47, 0.8)',
                borderColor: 'rgba(196, 18, 47, 1)',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                title: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0
                    }
                }
            }
        }
    });
}

function renderUtilizationTable(data) {
    const tbody = document.getElementById('utilization-table-body');
    tbody.innerHTML = '';

    data.forEach(item => {
        const row = document.createElement('tr');
        
        const utilizationRate = parseFloat(item.utilizationRate) || 0;
        let progressClass = '';
        if (utilizationRate >= 80) progressClass = 'critical';
        else if (utilizationRate >= 60) progressClass = 'high';

        row.innerHTML = `
            <td><strong>${item.equipment}</strong></td>
            <td>${item.totalQuantity}</td>
            <td>${item.inUseQuantity}</td>
            <td>${item.available}</td>
            <td>
                <div class="progress-bar">
                    <div class="progress-fill ${progressClass}" style="width: ${Math.min(utilizationRate, 100)}%">
                        ${utilizationRate.toFixed(1)}%
                    </div>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function renderDurationChart(data) {
    const ctx = document.getElementById('duration-chart');
    
    if (charts.duration) {
        charts.duration.destroy();
    }

    // Convert hours to days for better readability
    const daysData = data.map(item => ({
        ...item,
        avgDays: (item.avgHours / 24).toFixed(1)
    }));

    charts.duration = new Chart(ctx, {
        type: 'horizontalBar',
        data: {
            labels: daysData.map(item => item.equipmentBorrowed),
            datasets: [{
                label: 'Average Days Borrowed',
                data: daysData.map(item => item.avgDays),
                backgroundColor: 'rgba(13, 56, 98, 0.8)',
                borderColor: 'rgba(13, 56, 98, 1)',
                borderWidth: 2
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                x: {
                    beginAtZero: true
                }
            }
        }
    });
}

function renderTopBorrowersTable(data) {
    const tbody = document.getElementById('top-borrowers-table-body');
    tbody.innerHTML = '';

    data.forEach((item, index) => {
        const row = document.createElement('tr');
        
        let rankIcon = '';
        if (index === 0) rankIcon = '🥇';
        else if (index === 1) rankIcon = '🥈';
        else if (index === 2) rankIcon = '🥉';
        
        const statusBadge = item.currentlyBorrowed > 0 
            ? `<span class="badge warning">${item.currentlyBorrowed} Active</span>`
            : `<span class="badge success">None Active</span>`;

        row.innerHTML = `
            <td><strong>${rankIcon} #${index + 1}</strong></td>
            <td>${item.studentName}</td>
            <td>${item.borrowCount}</td>
            <td>${item.currentlyBorrowed}</td>
            <td>${statusBadge}</td>
        `;
        tbody.appendChild(row);
    });
}

function renderTeamChart(data) {
    const ctx = document.getElementById('team-chart');
    
    if (charts.team) {
        charts.team.destroy();
    }

    charts.team = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: data.map(item => item.issueType),
            datasets: [{
                data: data.map(item => item.count),
                backgroundColor: [
                    'rgba(196, 18, 47, 0.8)',
                    'rgba(13, 56, 98, 0.8)'
                ],
                borderColor: [
                    'rgba(196, 18, 47, 1)',
                    'rgba(13, 56, 98, 1)'
                ],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}

function renderReturnStatusChart(stats) {
    const ctx = document.getElementById('return-status-chart');
    
    if (charts.returnStatus) {
        charts.returnStatus.destroy();
    }

    charts.returnStatus = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: ['Returned', 'Pending', 'Overdue'],
            datasets: [{
                data: [
                    stats.totalReturned || 0,
                    stats.totalPending || 0,
                    stats.totalOverdue || 0
                ],
                backgroundColor: [
                    'rgba(30, 112, 39, 0.8)',
                    'rgba(243, 156, 18, 0.8)',
                    'rgba(231, 76, 60, 0.8)'
                ],
                borderColor: [
                    'rgba(30, 112, 39, 1)',
                    'rgba(243, 156, 18, 1)',
                    'rgba(231, 76, 60, 1)'
                ],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}

function renderMonthlyTrendsChart(data) {
    const ctx = document.getElementById('monthly-trends-chart');
    
    if (charts.monthlyTrends) {
        charts.monthlyTrends.destroy();
    }

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    // Create array for all 12 months
    const monthlyData = new Array(12).fill(0);
    const monthlyReturns = new Array(12).fill(0);
    
    data.forEach(item => {
        const monthIndex = item.month - 1;
        monthlyData[monthIndex] = item.borrowCount;
        monthlyReturns[monthIndex] = item.returnCount || 0;
    });

    charts.monthlyTrends = new Chart(ctx, {
        type: 'line',
        data: {
            labels: monthNames,
            datasets: [
                {
                    label: 'Items Borrowed',
                    data: monthlyData,
                    borderColor: 'rgba(196, 18, 47, 1)',
                    backgroundColor: 'rgba(196, 18, 47, 0.1)',
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true
                },
                {
                    label: 'Items Returned',
                    data: monthlyReturns,
                    borderColor: 'rgba(30, 112, 39, 1)',
                    backgroundColor: 'rgba(30, 112, 39, 0.1)',
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top'
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0
                    }
                }
            }
        }
    });
}

function renderRecentActivityChart(data) {
    const ctx = document.getElementById('recent-activity-chart');
    
    if (charts.recentActivity) {
        charts.recentActivity.destroy();
    }

    // Reverse the data so most recent is on the right
    const reversedData = [...data].reverse();

    charts.recentActivity = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: reversedData.map(item => {
                const date = new Date(item.date);
                return `${date.getMonth() + 1}/${date.getDate()}`;
            }),
            datasets: [{
                label: 'Items Borrowed',
                data: reversedData.map(item => item.borrowCount),
                backgroundColor: 'rgba(13, 56, 98, 0.8)',
                borderColor: 'rgba(13, 56, 98, 1)',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0
                    }
                }
            }
        }
    });
}
