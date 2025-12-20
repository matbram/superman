/**
 * Voxel Traffic System
 * Cars, taxis, trucks that drive on streets and can be destroyed
 * Vehicles are restricted to streets (at chunk edges) and sized realistically
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { STREET_WIDTH, CITY_CHUNK_SIZE } from './City';

// Traffic constants
const MAX_VEHICLES = 60;
const VEHICLE_DESPAWN_RADIUS = 500;
const STREET_Y = 0.1;  // Vehicles drive just above street level

// Street lane configuration - vehicles drive in lanes within the street width
const LANE_WIDTH = 4;  // Each lane is 4m wide
const LANES_PER_DIRECTION = 2;  // 2 lanes each direction = 4 lanes total

// Vehicle types
enum VehicleType {
  Car = 0,
  Taxi = 1,
  Truck = 2,
  Bus = 3,
}

/**
 * Individual vehicle
 */
interface Vehicle {
  root: TransformNode;
  meshes: Mesh[];
  type: VehicleType;
  position: Vector3;
  direction: Vector3;
  speed: number;
  health: number;
  isDestroyed: boolean;
  debrisVelocities: Vector3[];
}

/**
 * Traffic system - manages voxel vehicles
 */
export class Traffic {
  private scene: Scene;
  private vehicles: Vehicle[] = [];
  private vehicleMaterials: Map<string, StandardMaterial> = new Map();
  private onVehicleDestroyed: ((position: Vector3) => void) | null = null;

  constructor(scene: Scene) {
    this.scene = scene;
    this.createMaterials();
  }

  /**
   * Creates materials for vehicles
   */
  private createMaterials(): void {
    // Car colors
    const colors: [string, Color3][] = [
      ['red', new Color3(0.8, 0.15, 0.1)],
      ['blue', new Color3(0.1, 0.2, 0.7)],
      ['black', new Color3(0.1, 0.1, 0.12)],
      ['white', new Color3(0.9, 0.9, 0.88)],
      ['silver', new Color3(0.6, 0.62, 0.65)],
      ['green', new Color3(0.1, 0.5, 0.2)],
      ['yellow', new Color3(0.95, 0.85, 0.1)],  // Taxi
      ['orange', new Color3(0.9, 0.5, 0.1)],    // Bus/truck
    ];

    for (const [name, color] of colors) {
      const mat = new StandardMaterial(`vehicle_${name}`, this.scene);
      mat.diffuseColor = color;
      mat.specularColor = new Color3(0.3, 0.3, 0.3);
      mat.freeze();
      this.vehicleMaterials.set(name, mat);
    }

    // Window material
    const windowMat = new StandardMaterial('vehicle_window', this.scene);
    windowMat.diffuseColor = new Color3(0.2, 0.25, 0.35);
    windowMat.specularColor = new Color3(0.5, 0.5, 0.6);
    windowMat.alpha = 0.8;
    windowMat.freeze();
    this.vehicleMaterials.set('window', windowMat);

    // Tire material
    const tireMat = new StandardMaterial('vehicle_tire', this.scene);
    tireMat.diffuseColor = new Color3(0.15, 0.15, 0.15);
    tireMat.specularColor = new Color3(0.05, 0.05, 0.05);
    tireMat.freeze();
    this.vehicleMaterials.set('tire', tireMat);

    // Headlight material
    const lightMat = new StandardMaterial('vehicle_light', this.scene);
    lightMat.diffuseColor = new Color3(0.9, 0.9, 0.7);
    lightMat.emissiveColor = new Color3(0.3, 0.3, 0.2);
    lightMat.freeze();
    this.vehicleMaterials.set('light', lightMat);
  }

  /**
   * Creates a voxel car - realistically sized (2m wide × 5m long × 1.5m tall)
   */
  private createCar(colorName: string): Vehicle {
    const root = new TransformNode('car', this.scene);
    const meshes: Mesh[] = [];
    const bodyMat = this.vehicleMaterials.get(colorName)!;
    const windowMat = this.vehicleMaterials.get('window')!;
    const tireMat = this.vehicleMaterials.get('tire')!;

    // Car body - lower section (main chassis)
    const body = MeshBuilder.CreateBox('carBody', {
      width: 2.0, height: 1.0, depth: 5.0
    }, this.scene);
    body.position.y = 0.7;
    body.material = bodyMat;
    body.parent = root;
    meshes.push(body);

    // Car cabin - upper section
    const cabin = MeshBuilder.CreateBox('carCabin', {
      width: 1.9, height: 0.9, depth: 2.8
    }, this.scene);
    cabin.position = new Vector3(0, 1.65, -0.3);
    cabin.material = bodyMat;
    cabin.parent = root;
    meshes.push(cabin);

    // Front windshield
    const frontWindow = MeshBuilder.CreateBox('frontWindow', {
      width: 1.7, height: 0.7, depth: 0.15
    }, this.scene);
    frontWindow.position = new Vector3(0, 1.6, 1.1);
    frontWindow.rotation.x = -0.4;
    frontWindow.material = windowMat;
    frontWindow.parent = root;
    meshes.push(frontWindow);

    // Rear windshield
    const rearWindow = MeshBuilder.CreateBox('rearWindow', {
      width: 1.7, height: 0.6, depth: 0.15
    }, this.scene);
    rearWindow.position = new Vector3(0, 1.6, -1.5);
    rearWindow.rotation.x = 0.3;
    rearWindow.material = windowMat;
    rearWindow.parent = root;
    meshes.push(rearWindow);

    // Tires (4 corners) - properly sized
    const tirePositions = [
      new Vector3(-0.95, 0.4, 1.6),
      new Vector3(0.95, 0.4, 1.6),
      new Vector3(-0.95, 0.4, -1.6),
      new Vector3(0.95, 0.4, -1.6),
    ];
    for (const pos of tirePositions) {
      const tire = MeshBuilder.CreateBox('tire', {
        width: 0.35, height: 0.8, depth: 0.8
      }, this.scene);
      tire.position = pos;
      tire.material = tireMat;
      tire.parent = root;
      meshes.push(tire);
    }

    // Headlights
    const lightMat = this.vehicleMaterials.get('light')!;
    const headlightPositions = [new Vector3(-0.7, 0.6, 2.5), new Vector3(0.7, 0.6, 2.5)];
    for (const pos of headlightPositions) {
      const light = MeshBuilder.CreateBox('headlight', {
        width: 0.4, height: 0.25, depth: 0.1
      }, this.scene);
      light.position = pos;
      light.material = lightMat;
      light.parent = root;
      meshes.push(light);
    }

    return {
      root,
      meshes,
      type: VehicleType.Car,
      position: new Vector3(0, STREET_Y, 0),
      direction: new Vector3(1, 0, 0),
      speed: 12 + Math.random() * 8,  // 12-20 m/s (43-72 km/h)
      health: 100,
      isDestroyed: false,
      debrisVelocities: [],
    };
  }

  /**
   * Creates a voxel taxi (yellow car)
   */
  private createTaxi(): Vehicle {
    const vehicle = this.createCar('yellow');
    vehicle.type = VehicleType.Taxi;

    // Add taxi sign on roof
    const sign = MeshBuilder.CreateBox('taxiSign', {
      width: 0.6, height: 0.25, depth: 0.3
    }, this.scene);
    sign.position = new Vector3(0, 1.85, -0.3);
    sign.material = this.vehicleMaterials.get('light')!;
    sign.parent = vehicle.root;
    vehicle.meshes.push(sign);

    return vehicle;
  }

  /**
   * Creates a voxel truck - realistically sized (2.5m wide × 8m long × 4m tall)
   */
  private createTruck(): Vehicle {
    const root = new TransformNode('truck', this.scene);
    const meshes: Mesh[] = [];
    const bodyMat = this.vehicleMaterials.get('white')!;
    const cabMat = this.vehicleMaterials.get('red')!;
    const tireMat = this.vehicleMaterials.get('tire')!;
    const windowMat = this.vehicleMaterials.get('window')!;

    // Truck cab - larger and more detailed
    const cab = MeshBuilder.CreateBox('truckCab', {
      width: 2.5, height: 2.5, depth: 2.5
    }, this.scene);
    cab.position = new Vector3(0, 1.8, 3.0);
    cab.material = cabMat;
    cab.parent = root;
    meshes.push(cab);

    // Cab windshield
    const windshield = MeshBuilder.CreateBox('truckWindshield', {
      width: 2.2, height: 1.2, depth: 0.15
    }, this.scene);
    windshield.position = new Vector3(0, 2.2, 4.3);
    windshield.rotation.x = -0.15;
    windshield.material = windowMat;
    windshield.parent = root;
    meshes.push(windshield);

    // Truck cargo container - large box
    const cargo = MeshBuilder.CreateBox('truckCargo', {
      width: 2.6, height: 3.5, depth: 6.0
    }, this.scene);
    cargo.position = new Vector3(0, 2.3, -1.5);
    cargo.material = bodyMat;
    cargo.parent = root;
    meshes.push(cargo);

    // Tires (6 - 2 front, 4 back dual wheels) - larger truck tires
    const tirePositions = [
      new Vector3(-1.15, 0.55, 3.0),
      new Vector3(1.15, 0.55, 3.0),
      new Vector3(-1.15, 0.55, -2.0),
      new Vector3(1.15, 0.55, -2.0),
      new Vector3(-1.15, 0.55, -3.5),
      new Vector3(1.15, 0.55, -3.5),
    ];
    for (const pos of tirePositions) {
      const tire = MeshBuilder.CreateBox('tire', {
        width: 0.5, height: 1.1, depth: 1.1
      }, this.scene);
      tire.position = pos;
      tire.material = tireMat;
      tire.parent = root;
      meshes.push(tire);
    }

    // Headlights
    const lightMat = this.vehicleMaterials.get('light')!;
    const headlightPositions = [new Vector3(-1.0, 1.2, 4.3), new Vector3(1.0, 1.2, 4.3)];
    for (const pos of headlightPositions) {
      const light = MeshBuilder.CreateBox('headlight', {
        width: 0.5, height: 0.4, depth: 0.15
      }, this.scene);
      light.position = pos;
      light.material = lightMat;
      light.parent = root;
      meshes.push(light);
    }

    return {
      root,
      meshes,
      type: VehicleType.Truck,
      position: new Vector3(0, STREET_Y, 0),
      direction: new Vector3(1, 0, 0),
      speed: 10 + Math.random() * 5,  // 10-15 m/s (36-54 km/h)
      health: 250,
      isDestroyed: false,
      debrisVelocities: [],
    };
  }

  /**
   * Creates a voxel bus - realistically sized (2.8m wide × 12m long × 3.5m tall)
   */
  private createBus(): Vehicle {
    const root = new TransformNode('bus', this.scene);
    const meshes: Mesh[] = [];
    const bodyMat = this.vehicleMaterials.get('orange')!;
    const windowMat = this.vehicleMaterials.get('window')!;
    const tireMat = this.vehicleMaterials.get('tire')!;

    // Bus body - main chassis
    const body = MeshBuilder.CreateBox('busBody', {
      width: 2.8, height: 3.2, depth: 12.0
    }, this.scene);
    body.position.y = 2.0;
    body.material = bodyMat;
    body.parent = root;
    meshes.push(body);

    // Windows strip (rows of windows on sides)
    const windowsLeft = MeshBuilder.CreateBox('busWindowsLeft', {
      width: 0.12, height: 1.4, depth: 10.0
    }, this.scene);
    windowsLeft.position = new Vector3(-1.45, 2.5, 0);
    windowsLeft.material = windowMat;
    windowsLeft.parent = root;
    meshes.push(windowsLeft);

    const windowsRight = MeshBuilder.CreateBox('busWindowsRight', {
      width: 0.12, height: 1.4, depth: 10.0
    }, this.scene);
    windowsRight.position = new Vector3(1.45, 2.5, 0);
    windowsRight.material = windowMat;
    windowsRight.parent = root;
    meshes.push(windowsRight);

    // Front windshield
    const frontWindow = MeshBuilder.CreateBox('busFrontWindow', {
      width: 2.5, height: 1.5, depth: 0.15
    }, this.scene);
    frontWindow.position = new Vector3(0, 2.6, 6.0);
    frontWindow.material = windowMat;
    frontWindow.parent = root;
    meshes.push(frontWindow);

    // Tires (6) - larger bus tires
    const tirePositions = [
      new Vector3(-1.25, 0.6, 4.5),
      new Vector3(1.25, 0.6, 4.5),
      new Vector3(-1.25, 0.6, -1.5),
      new Vector3(1.25, 0.6, -1.5),
      new Vector3(-1.25, 0.6, -4.5),
      new Vector3(1.25, 0.6, -4.5),
    ];
    for (const pos of tirePositions) {
      const tire = MeshBuilder.CreateBox('tire', {
        width: 0.5, height: 1.2, depth: 1.2
      }, this.scene);
      tire.position = pos;
      tire.material = tireMat;
      tire.parent = root;
      meshes.push(tire);
    }

    // Headlights
    const lightMat = this.vehicleMaterials.get('light')!;
    const headlightPositions = [new Vector3(-1.1, 1.2, 6.0), new Vector3(1.1, 1.2, 6.0)];
    for (const pos of headlightPositions) {
      const light = MeshBuilder.CreateBox('headlight', {
        width: 0.5, height: 0.4, depth: 0.15
      }, this.scene);
      light.position = pos;
      light.material = lightMat;
      light.parent = root;
      meshes.push(light);
    }

    return {
      root,
      meshes,
      type: VehicleType.Bus,
      position: new Vector3(0, STREET_Y, 0),
      direction: new Vector3(1, 0, 0),
      speed: 8 + Math.random() * 4,  // 8-12 m/s (29-43 km/h)
      health: 400,
      isDestroyed: false,
      debrisVelocities: [],
    };
  }

  /**
   * Gets a random street position near the player
   * Streets are at chunk edges (first STREET_WIDTH meters of each chunk on all sides)
   */
  private getStreetPosition(playerPosition: Vector3): { x: number; z: number; isHorizontal: boolean; lane: number } {
    const angle = Math.random() * Math.PI * 2;
    const dist = 80 + Math.random() * 250;

    const baseX = playerPosition.x + Math.cos(angle) * dist;
    const baseZ = playerPosition.z + Math.sin(angle) * dist;

    // Determine which chunk we're near
    const chunkX = Math.floor(baseX / CITY_CHUNK_SIZE);
    const chunkZ = Math.floor(baseZ / CITY_CHUNK_SIZE);

    // Streets are at chunk edges. Pick either horizontal (along X) or vertical (along Z) street
    const isHorizontal = Math.random() > 0.5;

    // Pick a lane within the street (streets have multiple lanes)
    // Lane 0-1 go one direction, lanes 2-3 go the other direction
    const lane = Math.floor(Math.random() * (LANES_PER_DIRECTION * 2));
    const laneOffset = (lane - (LANES_PER_DIRECTION - 0.5)) * LANE_WIDTH;

    let x: number;
    let z: number;

    if (isHorizontal) {
      // Horizontal street - vehicle drives along X axis
      // Street is at the boundary between chunks (z = chunkZ * CITY_CHUNK_SIZE)
      x = baseX;
      // Position in the street with lane offset
      z = chunkZ * CITY_CHUNK_SIZE + STREET_WIDTH / 2 + laneOffset;
    } else {
      // Vertical street - vehicle drives along Z axis
      // Street is at the boundary between chunks (x = chunkX * CITY_CHUNK_SIZE)
      z = baseZ;
      // Position in the street with lane offset
      x = chunkX * CITY_CHUNK_SIZE + STREET_WIDTH / 2 + laneOffset;
    }

    return { x, z, isHorizontal, lane };
  }

  /**
   * Spawns a new vehicle near the player - restricted to streets only
   */
  private spawnVehicle(playerPosition: Vector3): void {
    if (this.vehicles.length >= MAX_VEHICLES) return;

    // Get a proper street position
    const { x, z, isHorizontal, lane } = this.getStreetPosition(playerPosition);

    // Create vehicle based on type
    const typeRoll = Math.random();
    let vehicle: Vehicle;

    if (typeRoll < 0.5) {
      // 50% regular cars
      const colors = ['red', 'blue', 'black', 'white', 'silver', 'green'];
      vehicle = this.createCar(colors[Math.floor(Math.random() * colors.length)]);
    } else if (typeRoll < 0.7) {
      // 20% taxis
      vehicle = this.createTaxi();
    } else if (typeRoll < 0.9) {
      // 20% trucks
      vehicle = this.createTruck();
    } else {
      // 10% buses
      vehicle = this.createBus();
    }

    vehicle.position = new Vector3(x, STREET_Y, z);
    vehicle.root.position = vehicle.position;

    // Direction based on street orientation and lane
    // Lanes 0-1 go positive direction, lanes 2-3 go negative direction
    const goingPositive = lane < LANES_PER_DIRECTION;

    if (isHorizontal) {
      vehicle.direction = new Vector3(goingPositive ? 1 : -1, 0, 0);
    } else {
      vehicle.direction = new Vector3(0, 0, goingPositive ? 1 : -1);
    }

    // Face direction of travel
    vehicle.root.rotation.y = Math.atan2(vehicle.direction.x, vehicle.direction.z);

    this.vehicles.push(vehicle);
  }

  /**
   * Applies damage to a vehicle
   */
  public applyDamage(vehicle: Vehicle, damage: number, impactDirection: Vector3): void {
    if (vehicle.isDestroyed) return;

    vehicle.health -= damage;

    if (vehicle.health <= 0) {
      this.destroyVehicle(vehicle, impactDirection);
    }
  }

  /**
   * Destroys a vehicle, turning it into debris
   */
  private destroyVehicle(vehicle: Vehicle, impactDirection: Vector3): void {
    vehicle.isDestroyed = true;

    // Initialize debris velocities for each mesh
    vehicle.debrisVelocities = vehicle.meshes.map(() => {
      return new Vector3(
        impactDirection.x * 10 + (Math.random() - 0.5) * 15,
        5 + Math.random() * 10,
        impactDirection.z * 10 + (Math.random() - 0.5) * 15
      );
    });

    // Detach meshes from root for individual physics
    for (const mesh of vehicle.meshes) {
      const worldPos = mesh.getAbsolutePosition();
      mesh.parent = null;
      mesh.position = worldPos;
    }

    if (this.onVehicleDestroyed) {
      this.onVehicleDestroyed(vehicle.position);
    }
  }

  /**
   * Updates all vehicles
   */
  public update(deltaTime: number, playerPosition: Vector3): void {
    // Spawn new vehicles if needed
    if (this.vehicles.length < MAX_VEHICLES) {
      if (Math.random() < 0.05) {  // 5% chance per frame
        this.spawnVehicle(playerPosition);
      }
    }

    // Update each vehicle
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const vehicle = this.vehicles[i];

      if (vehicle.isDestroyed) {
        // Update debris physics
        let allSettled = true;
        for (let j = 0; j < vehicle.meshes.length; j++) {
          const mesh = vehicle.meshes[j];
          const vel = vehicle.debrisVelocities[j];

          if (vel && vel.length() > 0.1) {
            allSettled = false;

            // Apply gravity
            vel.y -= 20 * deltaTime;

            // Move debris
            mesh.position.addInPlace(vel.scale(deltaTime));

            // Rotate debris
            mesh.rotation.x += vel.x * deltaTime * 0.5;
            mesh.rotation.z += vel.z * deltaTime * 0.5;

            // Ground collision
            if (mesh.position.y < 0.3) {
              mesh.position.y = 0.3;
              vel.y *= -0.3;
              vel.x *= 0.8;
              vel.z *= 0.8;

              if (Math.abs(vel.y) < 1) {
                vel.y = 0;
              }
            }

            // Damping
            vel.scaleInPlace(0.98);
          }
        }

        // Remove settled debris after time
        if (allSettled) {
          for (const mesh of vehicle.meshes) {
            mesh.dispose();
          }
          vehicle.root.dispose();
          this.vehicles.splice(i, 1);
        }
      } else {
        // Normal vehicle movement
        vehicle.position.addInPlace(vehicle.direction.scale(vehicle.speed * deltaTime));
        vehicle.root.position = vehicle.position;

        // Despawn if too far from player
        const dist = Vector3.Distance(vehicle.position, playerPosition);
        if (dist > VEHICLE_DESPAWN_RADIUS) {
          for (const mesh of vehicle.meshes) {
            mesh.dispose();
          }
          vehicle.root.dispose();
          this.vehicles.splice(i, 1);
        }
      }
    }
  }

  /**
   * Gets all vehicles for collision checking
   */
  public getVehicles(): Vehicle[] {
    return this.vehicles.filter(v => !v.isDestroyed);
  }

  /**
   * Checks collision with vehicles - uses larger hit radii for bigger vehicles
   */
  public checkCollision(position: Vector3, radius: number, velocity: Vector3): Vehicle | null {
    for (const vehicle of this.vehicles) {
      if (vehicle.isDestroyed) continue;

      const dist = Vector3.Distance(position, vehicle.position);
      // Hit radii based on actual vehicle sizes
      const hitRadius = vehicle.type === VehicleType.Bus ? 8 :    // 12m long bus
                        vehicle.type === VehicleType.Truck ? 6 :  // 8m long truck
                        3.5;                                       // 5m long car

      if (dist < radius + hitRadius) {
        // Calculate damage based on impact speed
        const impactSpeed = velocity.length();
        const damage = impactSpeed * 2;

        this.applyDamage(vehicle, damage, velocity.normalize());
        return vehicle;
      }
    }
    return null;
  }

  /**
   * Sets callback for vehicle destruction
   */
  public setOnVehicleDestroyed(callback: (position: Vector3) => void): void {
    this.onVehicleDestroyed = callback;
  }

  /**
   * Disposes all traffic resources
   */
  public dispose(): void {
    for (const vehicle of this.vehicles) {
      for (const mesh of vehicle.meshes) {
        mesh.dispose();
      }
      vehicle.root.dispose();
    }
    this.vehicles = [];

    for (const mat of this.vehicleMaterials.values()) {
      mat.dispose();
    }
  }
}
