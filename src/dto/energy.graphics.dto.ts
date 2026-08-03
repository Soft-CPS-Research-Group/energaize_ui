export type ConsumptionProductionDTO = {
    timestamp: string,
    "Energy Production from PV-kWh": number
    "Non-shiftable Load-kWh": number,
    "Net Electricity Consumption-kWh": number
}

export type BatteryDataDTO = {
    timestamp: string,
    "Battery Soc-%": number,
    "Battery (Dis)Charge-kWh": string | number
}

export type ElectricVehicleDataDTO = {
    timestamp: string; 
    'EV SOC-%': number | null;
    'EV Estimated SOC Arrival-%': number | null;
    'EV Required SOC Departure-%': number | null;
    'EV Departure Time'?: string;
    'EV Arrival Time'?: string;
}

export type ChargerDataDTO = {
    timestamp: string,
    Power: string | number | undefined,
    electric_vehicle: string | null
}

export type PricingDTO = {
    timestamp: string;
    'electricity_pricing-$/kWh': number;
};