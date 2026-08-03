// @ts-ignore
export enum EquipmentType {
    Battery = "batteries",
    ElectricVehicle = "electric_vehicles",
    Chargers = "charging_session",
    Building = "building",
}

export type SelectedEquipment = {
    id: string,
    type: EquipmentType
    building: string
}