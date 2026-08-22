import os
import json
import logging

SKILLS_DIR = os.path.join(os.path.dirname(__file__), 'skills')

class SkillRegistry:
    def __init__(self):
        self.skills = {}
        self.load_skills()
        
    def load_skills(self):
        if not os.path.exists(SKILLS_DIR):
            logging.info("Skills directory not found. Creating it.")
            os.makedirs(SKILLS_DIR, exist_ok=True)
            
        for item in os.listdir(SKILLS_DIR):
            item_path = os.path.join(SKILLS_DIR, item)
            if os.path.isdir(item_path):
                skill_file = os.path.join(item_path, 'skill.json')
                if os.path.exists(skill_file):
                    try:
                        with open(skill_file, 'r', encoding='utf-8') as f:
                            data = json.load(f)
                            if 'name' in data and 'description' in data:
                                self.skills[data['name']] = data
                                logging.info(f"Loaded skill: {data['name']}")
                            else:
                                logging.warning(f"Skill file {skill_file} missing 'name' or 'description'.")
                    except Exception as e:
                        logging.error(f"Failed to load skill {skill_file}: {e}")

    def get_all_skill_descriptions(self) -> str:
        if not self.skills:
            return "No skills available."
            
        desc = "Available Skills:\n"
        for name, data in self.skills.items():
            desc += f"- {name}: {data.get('description', '')}\n"
        return desc
        
    def get_skill(self, name: str) -> dict:
        return self.skills.get(name)

# Global registry instance
registry = SkillRegistry()
