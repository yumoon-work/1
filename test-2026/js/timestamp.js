function updateHelsinkiTime() {
    const now = new Date();
    
    const options = {
        timeZone: 'Europe/Helsinki',
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    };

    const formatter = new Intl.DateTimeFormat('en-GB', options);
    const parts = formatter.formatToParts(now);
    const d = {};
    parts.forEach(({type, value}) => { d[type] = value; });

    // Constructing the layout with line breaks (<br>)
    const dateLine = `${d.weekday}, ${d.day} ${d.month},`;
    const timeLine = `Helsinki, ${d.hour}:${d.minute}:${d.second}`;

    document.getElementById('timestamp').innerHTML = 
        `${dateLine}<br>${timeLine}`;
}

setInterval(updateHelsinkiTime, 1000);
updateHelsinkiTime();