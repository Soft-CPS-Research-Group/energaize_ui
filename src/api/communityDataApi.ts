import axios from 'axios'

const api = axios.create({
    baseURL: 'http://193.136.62.78:8000',
})

async function getCommunitiesData() {
    const response = await api.get('/energy-communities')
    return response.data;
}

async function getHistoricDataByCommunity(
    community: string,
    minutes?: number,
    offset?: number,
    limit?: number,
    from_ts?: string,
    until_ts?: string,
    granularity_minutes?: number
){
    const response = await api.get(`/historical-data/${community}`, {
        params: {
            minutes,
            offset,
            limit,
            from_ts,
            until_ts,
            granularity_minutes
        }
    });

    return response.data;
}

function connectRealTimeData(
    exchangeName: string,
    onMessageReceived: (data: any) => void
) {
    const socket = new WebSocket(`ws://193.136.62.78:8000/ws/data?exchange_name=${exchangeName}`);

    socket.onopen = () => {
        console.log(`Getting real time data from: ${exchangeName}`);
    };

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);

        onMessageReceived(data);
    };

    socket.onerror = (error) => {
        console.error("Websocket error:", error);
    };

    socket.onclose = () => {
        console.log("Websocket connection closed.");
    };

    return socket;
}

export { getCommunitiesData, getHistoricDataByCommunity, connectRealTimeData }
