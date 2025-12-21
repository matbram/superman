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
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { STREET_WIDTH, CITY_CHUNK_SIZE } from './City';

// Traffic constants
const MAX_VEHICLES = 100;  // Increased from 60 for heavier traffic
const VEHICLE_DESPAWN_RADIUS = 600;
const STREET_Y = 0.15;  // Vehicles drive just above street level

// Street lane configuration - vehicles drive in lanes within the street width
const LANE_WIDTH = 4;  // Each lane is 4m wide
const LANES_PER_DIRECTION = 2;  // 2 lanes each direction = 4 lanes total

// Vehicle scale multiplier - makes all vehicles larger
const VEHICLE_SCALE = 1.8;  // Scale up vehicles by 1.8x for visibility

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
  private shadowGenerator: ShadowGenerator | null = null;
  private vehicles: Vehicle[] = [];
  private vehicleMaterials: Map<string, StandardMaterial> = new Map();
  private onVehicleDestroyed: ((position: Vector3) => void) | null = null;

  constructor(scene: Scene, shadowGenerator?: ShadowGenerator) {
    this.scene = scene;
    this.shadowGenerator = shadowGenerator || null;
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
   * Creates a voxel car - scaled up for visibility
   */
  private createCar(colorName: string): Vehicle {
    const root = new TransformNode('car', this.scene);
    const meshes: Mesh[] = [];
    const bodyMat = this.vehicleMaterials.get(colorName)!;
    const windowMat = this.vehicleMaterials.get('window')!;
    const tireMat = this.vehicleMaterials.get('tire')!;
    const S = VEHICLE_SCALE;

    // Car body - lower section (main chassis)
    const body = MeshBuilder.CreateBox('carBody', {
      width: 2.2 * S, height: 1.1 * S, depth: 5.2 * S
    }, this.scene);
    body.position.y = 0.8 * S;
    body.material = bodyMat;
    body.parent = root;
    meshes.push(body);

    // Car cabin - upper section
    const cabin = MeshBuilder.CreateBox('carCabin', {
      width: 2.0 * S, height: 1.0 * S, depth: 3.0 * S
    }, this.scene);
    cabin.position = new Vector3(0, 1.8 * S, -0.3 * S);
    cabin.material = bodyMat;
    cabin.parent = root;
    meshes.push(cabin);

    // Front windshield
    const frontWindow = MeshBuilder.CreateBox('frontWindow', {
      width: 1.8 * S, height: 0.8 * S, depth: 0.2 * S
    }, this.scene);
    frontWindow.position = new Vector3(0, 1.7 * S, 1.2 * S);
    frontWindow.rotation.x = -0.4;
    frontWindow.material = windowMat;
    frontWindow.parent = root;
    meshes.push(frontWindow);

    // Rear windshield
    const rearWindow = MeshBuilder.CreateBox('rearWindow', {
      width: 1.8 * S, height: 0.7 * S, depth: 0.2 * S
    }, this.scene);
    rearWindow.position = new Vector3(0, 1.7 * S, -1.6 * S);
    rearWindow.rotation.x = 0.3;
    rearWindow.material = windowMat;
    rearWindow.parent = root;
    meshes.push(rearWindow);

    // Tires (4 corners) - properly sized
    const tirePositions = [
      new Vector3(-1.0 * S, 0.5 * S, 1.7 * S),
      new Vector3(1.0 * S, 0.5 * S, 1.7 * S),
      new Vector3(-1.0 * S, 0.5 * S, -1.7 * S),
      new Vector3(1.0 * S, 0.5 * S, -1.7 * S),
    ];
    for (const pos of tirePositions) {
      const tire = MeshBuilder.CreateBox('tire', {
        width: 0.4 * S, height: 1.0 * S, depth: 1.0 * S
      }, this.scene);
      tire.position = pos;
      tire.material = tireMat;
      tire.parent = root;
      meshes.push(tire);
    }

    // Headlights
    const lightMat = this.vehicleMaterials.get('light')!;
    const headlightPositions = [new Vector3(-0.8 * S, 0.7 * S, 2.6 * S), new Vector3(0.8 * S, 0.7 * S, 2.6 * S)];
    for (const pos of headlightPositions) {
      const light = MeshBuilder.CreateBox('headlight', {
        width: 0.5 * S, height: 0.3 * S, depth: 0.15 * S
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
      speed: 10 + Math.random() * 8,  // 10-18 m/s (36-65 km/h)
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
   * Creates a voxel truck - scaled up for visibility
   */
  private createTruck(): Vehicle {
    const root = new TransformNode('truck', this.scene);
    const meshes: Mesh[] = [];
    const bodyMat = this.vehicleMaterials.get('white')!;
    const cabMat = this.vehicleMaterials.get('red')!;
    const tireMat = this.vehicleMaterials.get('tire')!;
    const windowMat = this.vehicleMaterials.get('window')!;
    const S = VEHICLE_SCALE;

    // Truck cab - larger and more detailed
    const cab = MeshBuilder.CreateBox('truckCab', {
      width: 2.8 * S, height: 2.8 * S, depth: 2.8 * S
    }, this.scene);
    cab.position = new Vector3(0, 2.0 * S, 3.2 * S);
    cab.material = cabMat;
    cab.parent = root;
    meshes.push(cab);

    // Cab windshield
    const windshield = MeshBuilder.CreateBox('truckWindshield', {
      width: 2.5 * S, height: 1.4 * S, depth: 0.2 * S
    }, this.scene);
    windshield.position = new Vector3(0, 2.5 * S, 4.7 * S);
    windshield.rotation.x = -0.15;
    windshield.material = windowMat;
    windshield.parent = root;
    meshes.push(windshield);

    // Truck cargo container - large box
    const cargo = MeshBuilder.CreateBox('truckCargo', {
      width: 3.0 * S, height: 4.0 * S, depth: 7.0 * S
    }, this.scene);
    cargo.position = new Vector3(0, 2.6 * S, -1.8 * S);
    cargo.material = bodyMat;
    cargo.parent = root;
    meshes.push(cargo);

    // Tires (6 - 2 front, 4 back dual wheels) - larger truck tires
    const tirePositions = [
      new Vector3(-1.3 * S, 0.7 * S, 3.2 * S),
      new Vector3(1.3 * S, 0.7 * S, 3.2 * S),
      new Vector3(-1.3 * S, 0.7 * S, -2.2 * S),
      new Vector3(1.3 * S, 0.7 * S, -2.2 * S),
      new Vector3(-1.3 * S, 0.7 * S, -4.0 * S),
      new Vector3(1.3 * S, 0.7 * S, -4.0 * S),
    ];
    for (const pos of tirePositions) {
      const tire = MeshBuilder.CreateBox('tire', {
        width: 0.6 * S, height: 1.4 * S, depth: 1.4 * S
      }, this.scene);
      tire.position = pos;
      tire.material = tireMat;
      tire.parent = root;
      meshes.push(tire);
    }

    // Headlights
    const lightMat = this.vehicleMaterials.get('light')!;
    const headlightPositions = [new Vector3(-1.1 * S, 1.4 * S, 4.7 * S), new Vector3(1.1 * S, 1.4 * S, 4.7 * S)];
    for (const pos of headlightPositions) {
      const light = MeshBuilder.CreateBox('headlight', {
        width: 0.6 * S, height: 0.5 * S, depth: 0.2 * S
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
      speed: 8 + Math.random() * 5,  // 8-13 m/s (29-47 km/h)
      health: 300,
      isDestroyed: false,
      debrisVelocities: [],
    };
  }

  /**
   * Creates a voxel bus - scaled up for visibility
   */
  private createBus(): Vehicle {
    const root = new TransformNode('bus', this.scene);
    const meshes: Mesh[] = [];
    const bodyMat = this.vehicleMaterials.get('orange')!;
    const windowMat = this.vehicleMaterials.get('window')!;
    const tireMat = this.vehicleMaterials.get('tire')!;
    const S = VEHICLE_SCALE;

    // Bus body - main chassis
    const body = MeshBuilder.CreateBox('busBody', {
      width: 3.2 * S, height: 3.6 * S, depth: 14.0 * S
    }, this.scene);
    body.position.y = 2.4 * S;
    body.material = bodyMat;
    body.parent = root;
    meshes.push(body);

    // Windows strip (rows of windows on sides)
    const windowsLeft = MeshBuilder.CreateBox('busWindowsLeft', {
      width: 0.15 * S, height: 1.6 * S, depth: 12.0 * S
    }, this.scene);
    windowsLeft.position = new Vector3(-1.65 * S, 3.0 * S, 0);
    windowsLeft.material = windowMat;
    windowsLeft.parent = root;
    meshes.push(windowsLeft);

    const windowsRight = MeshBuilder.CreateBox('busWindowsRight', {
      width: 0.15 * S, height: 1.6 * S, depth: 12.0 * S
    }, this.scene);
    windowsRight.position = new Vector3(1.65 * S, 3.0 * S, 0);
    windowsRight.material = windowMat;
    windowsRight.parent = root;
    meshes.push(windowsRight);

    // Front windshield
    const frontWindow = MeshBuilder.CreateBox('busFrontWindow', {
      width: 2.8 * S, height: 1.8 * S, depth: 0.2 * S
    }, this.scene);
    frontWindow.position = new Vector3(0, 3.0 * S, 7.0 * S);
    frontWindow.material = windowMat;
    frontWindow.parent = root;
    meshes.push(frontWindow);

    // Tires (6) - larger bus tires
    const tirePositions = [
      new Vector3(-1.4 * S, 0.7 * S, 5.0 * S),
      new Vector3(1.4 * S, 0.7 * S, 5.0 * S),
      new Vector3(-1.4 * S, 0.7 * S, -1.8 * S),
      new Vector3(1.4 * S, 0.7 * S, -1.8 * S),
      new Vector3(-1.4 * S, 0.7 * S, -5.0 * S),
      new Vector3(1.4 * S, 0.7 * S, -5.0 * S),
    ];
    for (const pos of tirePositions) {
      const tire = MeshBuilder.CreateBox('tire', {
        width: 0.6 * S, height: 1.4 * S, depth: 1.4 * S
      }, this.scene);
      tire.position = pos;
      tire.material = tireMat;
      tire.parent = root;
      meshes.push(tire);
    }

    // Headlights
    const lightMat = this.vehicleMaterials.get('light')!;
    const headlightPositions = [new Vector3(-1.2 * S, 1.4 * S, 7.0 * S), new Vector3(1.2 * S, 1.4 * S, 7.0 * S)];
    for (const pos of headlightPositions) {
      const light = MeshBuilder.CreateBox('headlight', {
        width: 0.6 * S, height: 0.5 * S, depth: 0.2 * S
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
      speed: 7 + Math.random() * 4,  // 7-11 m/s (25-40 km/h)
      health: 500,
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

    // Add shadows to vehicle meshes
    this.addVehicleShadows(vehicle);

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
   * Adds shadow casting and receiving to a vehicle's meshes
   */
  private addVehicleShadows(vehicle: Vehicle): void {
    if (!this.shadowGenerator) return;

    for (const mesh of vehicle.meshes) {
      // Main body parts cast shadows
      if (mesh.name.includes('Body') || mesh.name.includes('Cabin') ||
          mesh.name.includes('cargo') || mesh.name.includes('cab')) {
        this.shadowGenerator.addShadowCaster(mesh);
      }
      // All parts receive shadows
      mesh.receiveShadows = true;
    }
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
    // Spawn new vehicles if needed - higher spawn rate for heavier traffic
    if (this.vehicles.length < MAX_VEHICLES) {
      if (Math.random() < 0.12) {  // 12% chance per frame for heavier traffic
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
      // Hit radii based on scaled vehicle sizes (VEHICLE_SCALE = 1.8)
      const hitRadius = vehicle.type === VehicleType.Bus ? 14 :    // Scaled bus
                        vehicle.type === VehicleType.Truck ? 10 :  // Scaled truck
                        6;                                          // Scaled car

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
